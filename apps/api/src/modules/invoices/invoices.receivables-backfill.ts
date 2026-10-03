import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { db as defaultDb } from '../../config/db.js';
import type { Database } from '../../db/types.js';
import { inTransaction } from '../../core/db/transaction.js';
import {
  OPEN_INVOICE_STATUSES,
  TERMINAL_RESERVATION_STATUSES,
  lockReservation,
  paidToDate,
} from '../../core/money/folio.js';
import {
  planReceivable,
  reconcileReceivable,
  type OpenInvoiceLite,
  type OpenInvoiceStatus,
  type ReceivableAction,
} from './invoices.receivable.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { ReservationsRepository } from '../reservations/reservations.repository.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { RoomsRepository } from '../rooms/rooms.repository.js';

/**
 * ── Phase 2 of `db:backfill-invoices`: make the books agree with the folios. ──────────
 *
 * Phase 1 (invoices.backfill.ts) gives every settled payment a receipt. This phase fixes
 * the OTHER half of the old behaviour — the receivable:
 *
 *   • a part payment used to leave a stale ISSUED "balance" invoice and the next one
 *     stacked another on top (Finance showed more owing than was true);
 *   • pay-later confirms, cockpit-wizard deposits, public /stay bookings and checkouts
 *     raised no invoice at all (Finance showed less owing than was true).
 *
 * For every booking it applies the SAME rule the live code now keeps
 * (invoices.receivable.ts): at most one open invoice, equal to agreed total − received;
 * none once the booking is cancelled / a no-show. Surplus open invoices are VOIDED, never
 * deleted (the number stays in the gapless series); the oldest is resized in place.
 *
 * WHAT IT WILL NOT DO is guess a price. The agreed total comes from, in order: the frozen
 * folio total; the quote behind a paid cockpit-wizard deposit; the invoices already raised.
 * A live booking with none of those is LISTED as "needs a price" and left alone —
 * unless `reconstructPrices` is set, which prices it at TODAY's rate plan (rate plans have
 * no effective dating, so for an old stay that is a reconstruction, not a recovery; the
 * same caveat as db:backfill-revenue). Don't set it without reading the list first.
 *
 * Bookings paid MORE than their agreed total are reported, never "fixed": whether that is a
 * refund owed or a wrong total is a human call.
 *
 * Dry run by default; safe to re-run (a booking already in agreement changes nothing).
 */

export interface ReceivablesBackfillOptions {
  dryRun?: boolean;
  /** Price bookings with no known total at today's rates (see above). Off by default. */
  reconstructPrices?: boolean;
  /**
   * Limit the run to these bookings. Lets the owner try one booking before the whole
   * ledger (`--reservation=<id>`), and keeps tests from touching other suites' data.
   */
  reservationIds?: string[];
}

export type PriceSource = 'FOLIO' | 'QUOTE' | 'INVOICES' | 'RECONSTRUCTED';

export interface ReceivablesBackfillDetail {
  reservation_id: string;
  status: string;
  total: number | null;
  total_source: PriceSource | null;
  paid: number;
  outstanding: number;
  /** Total would be frozen on the folio by this run. */
  freezes_total: boolean;
  actions: ReceivableAction[];
}

export interface ReceivablesBackfillResult {
  examined: number;
  /** Bookings whose invoices already agree with the folio. */
  in_agreement: number;
  /** Bookings that need (or got) at least one change. */
  changed: number;
  voided: number;
  resized: number;
  created: number;
  froze_totals: number;
  /** Live bookings with no known price — listed, untouched (unless reconstructPrices). */
  needs_price: Array<{ reservation_id: string; status: string; paid: number }>;
  /** paid > agreed total — a human decision (refund? wrong total?). */
  overpaid: Array<{ reservation_id: string; total: number; paid: number }>;
  /** Open invoices on soft-deleted bookings, retired. */
  voided_on_deleted: number;
  failed: Array<{ reservation_id: string; reason: string }>;
  details: ReceivablesBackfillDetail[];
}

/** Prices a booking at today's rate plan; null when it cannot be priced. Injected in tests. */
export type ReservationPricer = (
  reservationId: string
) => Promise<{ total: number; currency: string; taxRateBps: number } | null>;

function defaultPricer(dbInstance: Kysely<Database>): ReservationPricer {
  const service = new ReservationsService(
    new ReservationsRepository(dbInstance),
    new RoomsRepository(dbInstance),
    new PricingService(new PricingRepository(dbInstance))
  );
  return async (id) => {
    const priced = await service.priceReservation(id);
    return priced.priceable
      ? { total: priced.total_amount, currency: priced.currency, taxRateBps: priced.tax_rate_bps }
      : null;
  };
}

interface Assessment {
  total: number | null;
  source: PriceSource | null;
  currency?: string;
  taxRateBps?: number;
  paid: number;
  terminal: boolean;
  open: OpenInvoiceLite[];
}

const LIVE = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] as const;
const isLive = (status: string): boolean => (LIVE as readonly string[]).includes(status);

async function assess(
  q: Kysely<Database>,
  reservation: { id: string; status: string; folio_total_amount: number | null },
  opts: { reconstructPrices: boolean; pricer: ReservationPricer }
): Promise<Assessment> {
  const paid = (await paidToDate(q, [reservation.id])).get(reservation.id) ?? 0;
  const terminal = (TERMINAL_RESERVATION_STATUSES as readonly string[]).includes(reservation.status);

  const open = (
    await q
      .selectFrom('invoices')
      .select(['id', 'total_amount', 'status'])
      .where('reservation_id', '=', reservation.id)
      .where('deleted_at', 'is', null)
      .where('kind', '<>', 'REFUND')
      .where('status', 'in', [...OPEN_INVOICE_STATUSES])
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute()
  ).map((o) => ({ id: o.id, total_amount: o.total_amount, status: o.status as OpenInvoiceStatus }));

  let total: number | null = null;
  let source: PriceSource | null = null;
  let currency: string | undefined;
  let taxRateBps: number | undefined;

  if (reservation.folio_total_amount != null) {
    total = reservation.folio_total_amount;
    source = 'FOLIO';
  }

  if (total == null) {
    // A cockpit-wizard booking: its deposit was paid against a quote, which IS the price
    // that was agreed. Only trusted when money actually moved against that quote.
    const quote = await q
      .selectFrom('holds as h')
      .innerJoin('quotes as qt', 'qt.id', 'h.quote_id')
      .select(['qt.total_amount', 'qt.currency', 'qt.tax_rate_bps'])
      .where('h.reservation_id', '=', reservation.id)
      .where(({ exists, selectFrom }) =>
        exists(
          selectFrom('payment_intents as pi')
            .select(sql`1`.as('one'))
            .whereRef('pi.hold_id', '=', 'h.id')
            .where('pi.status', '=', 'PAID')
        )
      )
      .orderBy('qt.created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (quote) {
      total = quote.total_amount;
      source = 'QUOTE';
      currency = quote.currency;
      taxRateBps = quote.tax_rate_bps;
    }
  }

  if (total == null) {
    // The invoices already raised ARE the agreement (the reconstruction migration 067 used).
    const row = await q
      .selectFrom('invoices')
      .select(sql<string | null>`SUM(total_amount)`.as('total'))
      .where('reservation_id', '=', reservation.id)
      .where('deleted_at', 'is', null)
      .where('kind', '<>', 'REFUND')
      .where('status', '<>', 'VOID')
      .executeTakeFirst();
    if (row?.total != null) {
      total = Number(row.total);
      source = 'INVOICES';
    }
  }

  if (total == null && opts.reconstructPrices && isLive(reservation.status)) {
    const priced = await opts.pricer(reservation.id);
    if (priced) {
      total = priced.total;
      source = 'RECONSTRUCTED';
      currency = priced.currency;
      taxRateBps = priced.taxRateBps;
    }
  }

  return { total, source, currency, taxRateBps, paid, terminal, open };
}

export async function runReceivablesBackfill(
  dbInstance: Kysely<Database> = defaultDb,
  options: ReceivablesBackfillOptions = {},
  pricer: ReservationPricer = defaultPricer(dbInstance)
): Promise<ReceivablesBackfillResult> {
  const dryRun = options.dryRun ?? true;
  const reconstructPrices = options.reconstructPrices ?? false;

  const result: ReceivablesBackfillResult = {
    examined: 0,
    in_agreement: 0,
    changed: 0,
    voided: 0,
    resized: 0,
    created: 0,
    froze_totals: 0,
    needs_price: [],
    overpaid: [],
    voided_on_deleted: 0,
    failed: [],
    details: [],
  };

  // Who the changes are attributed to: the system actor, same rule as the other jobs.
  const actor = await dbInstance
    .selectFrom('users')
    .select('id')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!actor) throw new Error('No user to attribute the backfill to');
  const meta = { userId: actor.id };

  // Candidates: every live-stay booking, plus any other booking that has an invoice
  // (a PENDING website booking with a stale invoice, a CANCELLED one still owing).
  const only = options.reservationIds;
  let candidateQuery = dbInstance
    .selectFrom('reservations as r')
    .select(['r.id', 'r.status', 'r.folio_total_amount'])
    .where('r.deleted_at', 'is', null);
  if (only) candidateQuery = candidateQuery.where('r.id', 'in', only.length > 0 ? only : ['00000000-0000-0000-0000-000000000000']);
  const candidates = await candidateQuery
    .where('r.status', '<>', 'BLOCKED')
    .where(({ or, eb, exists, selectFrom }) =>
      or([
        eb('r.status', 'in', [...LIVE]),
        exists(
          selectFrom('invoices as i')
            .select(sql`1`.as('one'))
            .whereRef('i.reservation_id', '=', 'r.id')
            .where('i.deleted_at', 'is', null)
            .where('i.status', '<>', 'VOID')
        ),
      ])
    )
    .orderBy('r.created_at', 'asc')
    .execute();

  for (const candidate of candidates) {
    result.examined += 1;
    try {
      const view = await assess(dbInstance, candidate, { reconstructPrices, pricer });

      if (view.total == null) {
        if (isLive(candidate.status)) {
          result.needs_price.push({ reservation_id: candidate.id, status: candidate.status, paid: view.paid });
        }
        continue;
      }
      if (!view.terminal && view.paid > view.total) {
        result.overpaid.push({ reservation_id: candidate.id, total: view.total, paid: view.paid });
      }

      const freezes = candidate.folio_total_amount == null;
      const planned = planReceivable({
        total: view.total,
        paid: view.paid,
        terminal: view.terminal,
        open: view.open,
      });
      if (planned.length === 0 && !freezes) {
        result.in_agreement += 1;
        continue;
      }

      let actions = planned;
      let outstanding = view.terminal ? 0 : Math.max(0, view.total - view.paid);

      if (!dryRun) {
        // Re-assess and apply under the booking's lock: the numbers above were read
        // without one, and the live system may have moved since.
        const applied = await inTransaction(dbInstance, async (trx) => {
          const locked = await lockReservation(trx, candidate.id);
          if (!locked) return null;
          const fresh = await assess(trx, locked, { reconstructPrices, pricer });
          if (fresh.total == null) return null;

          if (locked.folio_total_amount == null) {
            await trx
              .updateTable('reservations')
              .set({
                folio_total_amount: fresh.total,
                ...(fresh.currency ? { folio_currency: fresh.currency } : {}),
                updated_by: meta.userId,
                updated_at: sql`now()`,
              })
              .where('id', '=', candidate.id)
              .execute();
            await trx.insertInto('audit_logs').values({
              request_id: null,
              user_id: meta.userId,
              action: 'UPDATE',
              entity: 'reservations',
              entity_id: candidate.id,
              diff: {
                folio_total_amount: fresh.total,
                reason: 'receivables_backfill',
                total_source: fresh.source,
              },
              ip_address: null,
            }).execute();
          }
          return reconcileReceivable(trx, candidate.id, meta, {
            taxRateBps: fresh.taxRateBps,
            currency: fresh.currency,
          });
        });
        if (!applied) continue;
        actions = applied.actions;
        outstanding = applied.outstanding;
      }

      if (freezes) result.froze_totals += 1;
      if (actions.length > 0 || freezes) result.changed += 1;
      else result.in_agreement += 1;
      for (const a of actions) {
        if (a.type === 'void') result.voided += 1;
        else if (a.type === 'resize') result.resized += 1;
        else result.created += 1;
      }
      result.details.push({
        reservation_id: candidate.id,
        status: candidate.status,
        total: view.total,
        total_source: view.source,
        paid: view.paid,
        outstanding,
        freezes_total: freezes,
        actions,
      });
    } catch (err) {
      result.failed.push({
        reservation_id: candidate.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Open invoices that belong to a soft-deleted booking: nothing can ever settle them.
  let orphanQuery = dbInstance
    .selectFrom('invoices as i')
    .innerJoin('reservations as r', 'r.id', 'i.reservation_id')
    .select(['i.id', 'i.total_amount'])
    .where('r.deleted_at', 'is not', null)
    .where('i.deleted_at', 'is', null)
    .where('i.kind', '<>', 'REFUND')
    .where('i.status', 'in', [...OPEN_INVOICE_STATUSES]);
  if (only) orphanQuery = orphanQuery.where('r.id', 'in', only.length > 0 ? only : ['00000000-0000-0000-0000-000000000000']);
  const orphaned = await orphanQuery.execute();
  for (const inv of orphaned) {
    if (!dryRun) {
      await inTransaction(dbInstance, async (trx) => {
        await trx
          .updateTable('invoices')
          .set({ status: 'VOID', updated_by: meta.userId, updated_at: sql`now()` })
          .where('id', '=', inv.id)
          .where('status', 'in', [...OPEN_INVOICE_STATUSES])
          .execute();
        await trx.insertInto('audit_logs').values({
          request_id: null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'invoices',
          entity_id: inv.id,
          diff: { status: 'VOID', reason: 'booking_deleted', total_amount: inv.total_amount },
          ip_address: null,
        }).execute();
      });
    }
    result.voided_on_deleted += 1;
  }

  return result;
}
