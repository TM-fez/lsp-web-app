import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import { EARNING_STATUSES } from './revenue.types.js';
import type {
  LiveNight,
  RecognisableReservation,
  RevenueRequestMeta,
  SupersedeReason,
} from './revenue.types.js';
import type { NightlySlice } from './revenue.util.js';

/**
 * G30 — reads and writes for the accrual revenue ledger (migration 069).
 *
 * The live ledger is `superseded_at IS NULL`. That predicate does here what
 * `deleted_at IS NULL` does everywhere else (invariant 5); this table has no
 * `deleted_at` because a ledger you can delete from is not a ledger.
 */
export class RevenueRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Every booking whose nights should be on the ledger, with the money needed to put
   * them there.
   *
   * `tax_rate_bps` is resolved in SQL rather than by N round trips, taking the first
   * of: an invoice actually raised for this booking (the rate the guest was really
   * charged), the quote behind its hold, then the rate plan currently active for the
   * unit's type. The last is a guess by construction — it is the same reason a
   * reconstructed total is labelled PRICED — but a booking with neither invoice nor
   * quote has no better answer anywhere in the system.
   *
   * The window bounds by STAY dates, not by booking dates: recognition is about the
   * nights, so a booking made last year for a stay next month belongs to next month.
   */
  async findRecognisable(window?: { from?: string; toExcl?: string }): Promise<RecognisableReservation[]> {
    const from = window?.from ? sql`AND r.check_out_date > ${window.from}::date` : sql``;
    const toExcl = window?.toExcl ? sql`AND r.check_in_date < ${window.toExcl}::date` : sql``;

    const result = await sql<RecognisableReservation>`
      SELECT
        r.id,
        r.room_id,
        to_char(r.check_in_date,  'YYYY-MM-DD') AS check_in_date,
        to_char(r.check_out_date, 'YYYY-MM-DD') AS check_out_date,
        r.status::text AS status,
        r.folio_total_amount,
        r.folio_currency,
        COALESCE(
          (SELECT i.tax_rate_bps
             FROM invoices i
            WHERE i.reservation_id = r.id AND i.kind <> 'REFUND' AND i.deleted_at IS NULL
            ORDER BY i.created_at DESC
            LIMIT 1),
          (SELECT q.tax_rate_bps
             FROM holds h
             JOIN quotes q ON q.id = h.quote_id
            WHERE h.reservation_id = r.id AND h.deleted_at IS NULL
            ORDER BY h.created_at DESC
            LIMIT 1),
          (SELECT rp.tax_rate_bps
             FROM rate_plans rp
            WHERE rp.unit_type = rm.type AND rp.active AND rp.deleted_at IS NULL
            LIMIT 1),
          0
        )::int AS tax_rate_bps
      FROM reservations r
      JOIN rooms rm ON rm.id = r.room_id
      WHERE r.deleted_at IS NULL
        AND r.status IN (${sql.join(EARNING_STATUSES.map((s) => sql`${s}`))})
        ${from}
        ${toExcl}
      ORDER BY r.check_in_date
    `.execute(this.db);

    return result.rows;
  }

  /**
   * Bookings that have live ledger rows but should NOT — cancelled, no-showed, soft
   * deleted, or reverted to PENDING since they were recognised.
   *
   * Kept separate from findRecognisable() because the sweep has to look for the
   * ABSENCE of a reason to earn, which no filter over earning bookings can see.
   */
  async findNoLongerEarning(): Promise<string[]> {
    const result = await sql<{ reservation_id: string }>`
      SELECT DISTINCT rr.reservation_id
      FROM revenue_recognition rr
      JOIN reservations r ON r.id = rr.reservation_id
      WHERE rr.superseded_at IS NULL
        AND (r.deleted_at IS NOT NULL
             OR r.status NOT IN (${sql.join(EARNING_STATUSES.map((s) => sql`${s}`))}))
    `.execute(this.db);

    return result.rows.map((row) => row.reservation_id);
  }

  /**
   * The live recognised nights of one booking, earliest first.
   *
   * `stay_date` is formatted to 'YYYY-MM-DD' in SQL rather than selected raw. See the
   * note on LiveNight: a driver-parsed `date` lands on midnight in the Node process's
   * timezone, so under TZ=Africa/Gaborone it reads back as the previous day.
   */
  async liveNights(reservationId: string): Promise<LiveNight[]> {
    return this.db
      .selectFrom('revenue_recognition')
      .select([
        'id',
        'reservation_id',
        'room_id',
        sql<string>`to_char(stay_date, 'YYYY-MM-DD')`.as('stay_date'),
        'currency',
        'amount',
        'tax_amount',
        'tax_rate_bps',
        'total_source',
        'version',
      ])
      .where('reservation_id', '=', reservationId)
      .where('superseded_at', 'is', null)
      .orderBy('stay_date')
      .execute();
  }

  /**
   * Replace a booking's live nights with a new version, in one transaction.
   *
   * Supersede-then-insert, never UPDATE: a recognised night is a statement about a
   * period that may already have been reported, so a change writes a new row and
   * leaves the old one standing as history. `version` continues the booking's own
   * count rather than restarting, so "what did we say this stay earned, and when?"
   * is answerable from the table alone.
   *
   * Passing no slices supersedes with no replacement — the cancellation case. It is
   * a legal outcome, not a no-op: the CHECK on the table allows a superseded row with
   * no `superseded_by` precisely so a cancelled stay has somewhere to go.
   */
  async replaceNights(
    input: {
      reservationId: string;
      roomId: string;
      currency: string;
      taxRateBps: number;
      totalSource: 'FOLIO' | 'PRICED';
      slices: NightlySlice[];
      reason: SupersedeReason;
    },
    meta: RevenueRequestMeta
  ): Promise<{ written: number; superseded: number }> {
    return this.db.transaction().execute(async (trx) => {
      const previous = await trx
        .selectFrom('revenue_recognition')
        .select(['id', 'version'])
        .where('reservation_id', '=', input.reservationId)
        .where('superseded_at', 'is', null)
        .execute();

      // One past the highest version this booking has ever carried, so a night that
      // has been restated three times reads as version 4 even if the middle version
      // covered different dates.
      const highest = await trx
        .selectFrom('revenue_recognition')
        .select(({ fn }) => fn.max('version').as('version'))
        .where('reservation_id', '=', input.reservationId)
        .executeTakeFirst();
      const nextVersion = Number(highest?.version ?? 0) + 1;

      // Supersede BEFORE inserting, in three statements rather than the obvious two.
      //
      // `revenue_recognition_live_night` allows one live row per booking-night, so
      // inserting the new version while the old one is still live collides on every
      // night that appears in both — which is most of them, on a re-price. Clearing
      // the old rows first leaves the booking with no live nights, which is exactly
      // the state the index exists to protect. The index cannot be deferred to the
      // end of the transaction instead: a PARTIAL unique index cannot be declared as
      // a deferrable constraint.
      //
      // The cost is that `superseded_by` cannot be filled in until the replacement
      // rows exist, hence the third statement. All three commit together.
      if (previous.length) {
        await trx
          .updateTable('revenue_recognition')
          .set({ superseded_at: sql`now()`, superseded_reason: input.reason })
          .where(
            'id',
            'in',
            previous.map((row) => row.id)
          )
          .execute();
      }

      const inserted = input.slices.length
        ? await trx
            .insertInto('revenue_recognition')
            .values(
              input.slices.map((slice) => ({
                reservation_id: input.reservationId,
                room_id: input.roomId,
                stay_date: slice.stay_date,
                currency: input.currency,
                amount: slice.amount,
                tax_amount: slice.tax_amount,
                tax_rate_bps: input.taxRateBps,
                total_source: input.totalSource,
                version: nextVersion,
                created_by: meta.userId,
              }))
            )
            .returning('id')
            .execute()
        : [];

      // Points at the first replacement row: enough to walk forward from any
      // superseded night to the version that replaced it. Left null when nothing
      // replaced it at all — a cancelled stay, which the superseded-pair CHECK
      // deliberately allows.
      if (previous.length && inserted.length) {
        await trx
          .updateTable('revenue_recognition')
          .set({ superseded_by: inserted[0]!.id })
          .where(
            'id',
            'in',
            previous.map((row) => row.id)
          )
          .execute();
      }

      await trx
        .insertInto('audit_logs')
        .values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: previous.length ? 'UPDATE' : 'CREATE',
          entity: 'revenue_recognition',
          entity_id: input.reservationId,
          diff: {
            reason: input.reason,
            version: nextVersion,
            nights_written: inserted.length,
            nights_superseded: previous.length,
            total_source: input.totalSource,
            amount: input.slices.reduce((sum, slice) => sum + slice.amount, 0),
          },
          ip_address: meta.ip ?? null,
        })
        .execute();

      return { written: inserted.length, superseded: previous.length };
    });
  }
}
