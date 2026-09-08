import type { Kysely } from 'kysely';
import { db as defaultDb } from '../../config/db.js';
import type { Database } from '../../db/types.js';
import { FilesRepository } from '../files/files.repository.js';
import { HoldsRepository } from '../holds/holds.repository.js';
import { HoldsService } from '../holds/holds.service.js';
import { InvoicesRepository } from '../invoices/invoices.repository.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { PaymentsRepository } from '../payments/payments.repository.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { QuotesRepository } from '../quotes/quotes.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { ReservationsRepository } from '../reservations/reservations.repository.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { RoomsRepository } from '../rooms/rooms.repository.js';
import { RevenueRepository } from './revenue.repository.js';
import { RevenueService, type StayPricer } from './revenue.service.js';
import type { RecogniseResult, RevenueRequestMeta } from './revenue.types.js';

/**
 * G30 — the historic backfill: put the nights of every past stay onto the accrual
 * ledger, once.
 *
 * Two things make this a separate job rather than a wider sweep.
 *
 * 1. IT HAS NO WINDOW. The nightly sweep reconciles a rolling window around the
 *    property day, because settled months do not change and rescanning years of them
 *    every night buys a guaranteed no-op. The backfill is the run that does look at
 *    all of it — which is why it is run deliberately, once, rather than on a timer.
 *
 * 2. IT RECONSTRUCTS. A pricer IS wired here, so a stay that never had its total
 *    frozen gets priced and recognised instead of being skipped. The sweep refuses to
 *    do that on purpose: rate plans have no effective dating, so live pricing resolves
 *    the CURRENTLY active plan, and reconstructing nightly would restate every
 *    unfrozen booking each time a rate moved.
 *
 * ⚠️ The honest limit, and the reason the caller must show it: a reconstructed stay is
 * priced at TODAY's rates. Figures before go-live are a RECONSTRUCTION, not a
 * recovery. Every such night is written with total_source = 'PRICED' so the flag
 * travels with the data instead of living only in someone's memory of this run, and
 * the result reports reconstructed nights and amounts separately so "how much of this
 * is guesswork" is answerable before anything is applied.
 *
 * Safe to run more than once: reconcile() leaves an agreeing booking untouched. Run it
 * twice and the second pass changes nothing — except where rates have moved since,
 * which restates exactly the reconstructed stays and is the same caveat again.
 */

/** The full reservations service, wired only so far as priceReservation() needs. */
export function createStayPricer(dbInstance: Kysely<Database> = defaultDb): StayPricer {
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const quotes = new QuotesService(new QuotesRepository(dbInstance), pricing);
  const holds = new HoldsService(new HoldsRepository(dbInstance), quotes);
  const payments = new PaymentsService(new PaymentsRepository(dbInstance), new HoldsRepository(dbInstance), quotes);
  const invoices = new InvoicesService(new InvoicesRepository(dbInstance), quotes, new FilesRepository(dbInstance));

  return new ReservationsService(
    new ReservationsRepository(dbInstance),
    new RoomsRepository(dbInstance),
    pricing,
    quotes,
    holds,
    payments,
    invoices
  );
}

export interface BackfillOptions {
  /** Preview only — count everything, write nothing. The default, deliberately. */
  dryRun?: boolean;
  /**
   * Earliest stay date to consider, 'YYYY-MM-DD'. Bounds by the NIGHT, not the
   * booking date: a stay is recognised in the month it was slept in.
   */
  from?: string;
  /** Exclusive upper bound, 'YYYY-MM-DD'. Omit for "everything, forever". */
  toExcl?: string;
}

/**
 * Reconcile the whole ledger with reconstruction enabled.
 *
 * `meta.userId` is null: nobody typed this, an operator ran it. The audit_logs rows
 * replaceNights() writes carry the reason and the version, so the run is still on the
 * record even though no user account is behind it.
 */
export async function runRevenueBackfill(
  dbInstance: Kysely<Database> = defaultDb,
  options: BackfillOptions = {},
  meta: RevenueRequestMeta = { userId: null }
): Promise<RecogniseResult> {
  const service = new RevenueService(new RevenueRepository(dbInstance), createStayPricer(dbInstance));

  return service.reconcile(
    { from: options.from, toExcl: options.toExcl },
    meta,
    { dryRun: options.dryRun ?? true }
  );
}
