import { RevenueRepository } from './revenue.repository.js';
import { splitStayAcrossNights, type NightlySlice } from './revenue.util.js';
import type {
  LiveNight,
  RecogniseResult,
  RecognisableReservation,
  RevenueRequestMeta,
  SupersedeReason,
} from './revenue.types.js';

/**
 * What the recogniser needs from pricing, and no more.
 *
 * Narrow on purpose: `ReservationsService.priceReservation` satisfies it, so the
 * dependency runs revenue -> reservations and never back. Reservations knows nothing
 * about the ledger, which is what keeps a recognition failure from ever being able to
 * break a booking (invariant 7 — the money axis decides nothing about the room).
 */
export interface StayPricer {
  priceReservation(id: string): Promise<{ total_amount?: number; currency?: string; priceable?: boolean }>;
}

/** The system user for sweeps: nobody typed this, the scheduler did. */
const SWEEP_ACTOR = null;

/** (R7 N7-1) How many times one booking is re-priced when it keeps changing underneath us. */
const MAX_RECONCILE_ATTEMPTS = 3;
const DONE = Symbol('done');

/** The same booking, as far as what it earns goes — every column the ledger is built from. */
function sameInputs(a: RecognisableReservation, b: RecognisableReservation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class RevenueService {
  constructor(
    private readonly repository: RevenueRepository,
    private readonly pricer?: StayPricer
  ) {}

  /**
   * Bring the ledger into agreement with the bookings — the ONE write path, used by
   * the nightly sweep and by the historic backfill alike.
   *
   * Reconciling rather than appending is what makes it safe to run repeatedly: a
   * booking whose live nights already match what it should earn is left completely
   * alone, so the sweep is idempotent and re-running the backfill cannot double-count
   * a night. That matters more than it sounds — the alternative (write on every
   * lifecycle event) needs a hook in every mutation path, and a hook that is missed
   * is a month that silently under-reports.
   *
   * Deliberately NOT bounded to nights that have already happened. The ledger holds
   * every night of an earning stay, including future ones, because "which nights has
   * this booking sold" is a fact that does not depend on today's date — and a
   * date-dependent table would make this sweep non-idempotent. It is the REPORTS that
   * must bound their window at the property day: summing the ledger to "today" without
   * an upper bound would count nights nobody has slept yet.
   */
  async reconcile(
    window?: { from?: string; toExcl?: string; reservationIds?: string[] },
    meta: RevenueRequestMeta = { userId: SWEEP_ACTOR },
    options: { dryRun?: boolean } = {}
  ): Promise<RecogniseResult> {
    const result: RecogniseResult = {
      reservations_examined: 0,
      reservations_changed: 0,
      nights_written: 0,
      nights_superseded: 0,
      reconstructed: 0,
      nights_reconstructed: 0,
      amount_reconstructed: 0,
      amount_written: 0,
      unpriced: 0,
    };

    const earning = await this.repository.findRecognisable(window);
    result.reservations_examined = earning.length;

    for (const listed of earning) {
      // (R6 NEW-9, R7 N7-1) Work out what the booking SHOULD say first — that may price it,
      // which needs the pool — then take its lock and, inside it, only check and write.
      // If the booking changed while we were pricing it (another edit committed), price
      // the fresh version and try again; a newer edit's own reconcile also runs, so giving
      // up after a few rounds still converges.
      let reservation = listed;
      for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt += 1) {
        const desired = await this.desiredNights(reservation);
        const current = reservation;
        const outcome = await this.repository.lockedFor(current.id, async (locked) => {
          const [fresh] = await locked.findRecognisable({ reservationIds: [current.id] });
          if (!fresh) return DONE; // stopped earning meanwhile — the loop below handles that
          if (!sameInputs(fresh, current)) return fresh;

          // No agreed total and nothing to reconstruct one from: leave the booking
          // completely alone, rather than treating "we cannot price it" as "it earns
          // nothing". The difference matters — falling through would supersede real
          // recognised nights the moment a pricer went missing, destroying a month of
          // ledger because of a wiring change.
          if (desired.unpriced) {
            result.unpriced += 1;
            return DONE;
          }
          if (desired.totalSource === 'PRICED') result.reconstructed += 1;

          const live = await locked.liveNights(current.id);
          const reason = supersedeReason(live, desired.slices, current.room_id);
          if (reason === null) return DONE; // already agrees — leave it entirely alone

          const amount = desired.slices.reduce((sum, slice) => sum + slice.amount, 0);

          // A dry run counts exactly what an apply would write, and writes nothing. Each
          // booking is measured against the live ledger independently, so skipping the
          // write cannot skew the ones that follow.
          const written = options.dryRun
            ? { written: desired.slices.length, superseded: live.length }
            : await locked.replaceNights(
                {
                  reservationId: current.id,
                  roomId: current.room_id,
                  currency: current.folio_currency,
                  taxRateBps: current.tax_rate_bps,
                  totalSource: desired.totalSource,
                  slices: desired.slices,
                  reason,
                },
                meta
              );

          result.reservations_changed += 1;
          result.nights_written += written.written;
          result.nights_superseded += written.superseded;
          result.amount_written += amount;
          if (desired.totalSource === 'PRICED') {
            result.nights_reconstructed += written.written;
            result.amount_reconstructed += amount;
          }
          return DONE;
        });
        if (outcome === DONE) break;
        reservation = outcome;
      }
    }

    // The other half of agreement: bookings that still have live nights but have
    // stopped earning them. Cancelled after the sweep last ran, no-showed, soft
    // deleted, or pushed back to PENDING.
    for (const reservationId of await this.repository.findNoLongerEarning(window?.reservationIds)) {
      // Same lock as above, so this can't interleave with a reconcile of the same booking.
      await this.repository.lockedFor(reservationId, async (locked) => {
        const live = await locked.liveNights(reservationId);
        if (!live.length) return;

        const written = options.dryRun
          ? { written: 0, superseded: live.length }
          : await locked.replaceNights(
              {
                reservationId,
                roomId: live[0]!.room_id,
                currency: live[0]!.currency,
                taxRateBps: live[0]!.tax_rate_bps,
                totalSource: live[0]!.total_source,
                slices: [],
                reason: 'NO_LONGER_EARNING',
              },
              meta
            );

        result.reservations_changed += 1;
        result.nights_superseded += written.superseded;
      });
    }

    return result;
  }

  /**
   * Put just these bookings' nights on the ledger NOW (N-11) — called right after a
   * request that may have changed what they earn, so the accrual P&L is right for a
   * booking taken a minute ago instead of after the next sweep. `ids` may be booking,
   * invoice, hold or payment-intent ids; anything that is not one is ignored.
   *
   * Same reconcile as the sweep, so it is idempotent: an agreeing booking is untouched.
   */
  async reconcileFor(ids: string[], meta: RevenueRequestMeta = { userId: SWEEP_ACTOR }): Promise<RecogniseResult> {
    const reservationIds = await this.repository.reservationsBehind(ids);
    if (!reservationIds.length) return this.reconcileNothing();
    return this.reconcile({ reservationIds }, meta);
  }

  private reconcileNothing(): RecogniseResult {
    return {
      reservations_examined: 0, reservations_changed: 0, nights_written: 0, nights_superseded: 0,
      reconstructed: 0, nights_reconstructed: 0, amount_reconstructed: 0, amount_written: 0, unpriced: 0,
    };
  }

  /**
   * What this booking's nights SHOULD say.
   *
   * The frozen folio total wins whenever there is one, because rate plans have no
   * effective dating and re-pricing an old stay at today's rates would restate a
   * month the owner has already read. Falling back to live pricing is a
   * RECONSTRUCTION, flagged PRICED all the way through to the screen — the known
   * limit the owner was told about when the accrual decision was taken.
   */
  private async desiredNights(
    reservation: RecognisableReservation
  ): Promise<{ slices: NightlySlice[]; totalSource: 'FOLIO' | 'PRICED'; unpriced: boolean }> {
    if (reservation.folio_total_amount != null) {
      return {
        slices: splitStayAcrossNights(
          reservation.check_in_date,
          reservation.check_out_date,
          reservation.folio_total_amount,
          reservation.tax_rate_bps
        ),
        totalSource: 'FOLIO',
        unpriced: false,
      };
    }

    // No pricer wired. That is the DAILY SWEEP's deliberate configuration, not an
    // oversight: reconstructing at today's rates every night would restate every
    // unfrozen booking each time a rate moved, churning the ledger for figures that
    // were never agreed. Reconstruction belongs to the backfill, which is run once and
    // announced. The caller counts these and moves on.
    if (!this.pricer) return { slices: [], totalSource: 'PRICED', unpriced: true };

    const priced = await this.pricer.priceReservation(reservation.id);

    // A unit type with no active rate plan cannot be priced by any route — and that
    // is UNPRICED, not zero. The distinction is the whole difference between "we do
    // not know what this stay earned" and "this stay earned nothing", and only the
    // second is a statement the book of record is allowed to make. Writing a night at
    // zero would put a confirmed stay in the P&L as free.
    //
    // getFolio() answers 0 for the same case on purpose, but that is a DISPLAY
    // fallback so the drawer does not blank — nobody reconciles a month from it.
    if (priced.priceable === false || priced.total_amount == null) {
      return { slices: [], totalSource: 'PRICED', unpriced: true };
    }

    return {
      slices: splitStayAcrossNights(
        reservation.check_in_date,
        reservation.check_out_date,
        priced.total_amount,
        reservation.tax_rate_bps
      ),
      totalSource: 'PRICED',
      unpriced: false,
    };
  }
}

/**
 * Why the live nights need replacing — or null when they do not.
 *
 * Returning null for "no change" is what makes the sweep idempotent, so this
 * comparison has to be exact: a difference it misses is a month that never gets
 * corrected, and a difference it invents is a superseded row every single night.
 */
function supersedeReason(
  live: LiveNight[],
  desired: NightlySlice[],
  roomId: string
): SupersedeReason | null {
  if (live.length === 0) return desired.length === 0 ? null : 'RE_PRICED';
  if (desired.length === 0) return 'NO_LONGER_EARNING';

  if (live.some((night) => night.room_id !== roomId)) return 'ROOM_CHANGED';

  // Both sides are 'YYYY-MM-DD' strings — the repository formats stay_date in SQL
  // precisely so this comparison never goes through a driver-parsed Date. See the
  // note on LiveNight: under TZ=Africa/Gaborone that would shift every night back a
  // day and make the sweep restate the whole ledger every run.
  const liveByDate = new Map(live.map((night) => [night.stay_date, night]));
  if (liveByDate.size !== desired.length) return 'DATES_CHANGED';

  for (const slice of desired) {
    const night = liveByDate.get(slice.stay_date);
    if (!night) return 'DATES_CHANGED';
    if (night.amount !== slice.amount || night.tax_amount !== slice.tax_amount) return 'RE_PRICED';
  }

  return null;
}
