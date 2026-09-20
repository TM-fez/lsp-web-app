import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { db as defaultDb } from '../../config/db.js';
import type { Database } from '../../db/types.js';
import { FilesRepository } from '../files/files.repository.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { QuotesRepository } from '../quotes/quotes.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { InvoicesRepository } from './invoices.repository.js';
import { InvoicesService } from './invoices.service.js';

/**
 * Raise a PAID receipt invoice for every settled payment that has none.
 *
 * Why this exists: only `ReservationsService.recordPayment` (desk pay) raises a
 * receipt after settlePaid(). The commercial money-loop (quote → hold → attempt)
 * confirms the stay and records the payment intent as PAID, then stops — so ~24
 * live receipts never became invoice documents. Finance / Accounts read invoices,
 * not payment_intents, so collected money was invisible.
 *
 * Safe to re-run:
 *   1. Skip any intent that already has `invoice_id` set.
 *   2. Otherwise look for an unmatched PAID invoice on the same hold with the
 *      same amount + kind (a receipt Accounts may already have raised by hand)
 *      and link it — healing the FK without minting a duplicate number.
 *   3. Only then call issueSettledInvoice() and write the link.
 *
 * Dry-run by default: counts and lists, writes nothing. `invoice_id` on
 * payment_intents is the idempotency key going forward (the column was always
 * there; nothing had been writing it).
 */

export interface InvoiceBackfillOptions {
  /** Preview only — count everything, write nothing. The default, deliberately. */
  dryRun?: boolean;
}

export interface InvoiceBackfillResult {
  examined: number;
  linked: number;
  created: number;
  skipped: number;
  failed: number;
  /** Intent ids that would be / were acted on, for the CLI summary. */
  details: Array<{
    payment_intent_id: string;
    action: 'link' | 'create' | 'skip' | 'fail';
    amount: number;
    purpose: 'DEPOSIT' | 'BALANCE';
    invoice_id?: string;
    reason?: string;
  }>;
}

interface OrphanPaidIntent {
  id: string;
  hold_id: string;
  quote_id: string;
  purpose: 'DEPOSIT' | 'BALANCE';
  amount: number;
  created_by: string;
  reservation_id: string | null;
}

function createInvoicesService(dbInstance: Kysely<Database>): InvoicesService {
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const quotes = new QuotesService(new QuotesRepository(dbInstance), pricing);
  return new InvoicesService(
    new InvoicesRepository(dbInstance),
    quotes,
    new FilesRepository(dbInstance)
  );
}

/** Paid intents with no invoice_id — the ones that may still need a receipt. */
async function findOrphanPaidIntents(dbInstance: Kysely<Database>): Promise<OrphanPaidIntent[]> {
  return dbInstance
    .selectFrom('payment_intents as pi')
    .leftJoin('holds as h', 'h.id', 'pi.hold_id')
    .select([
      'pi.id',
      'pi.hold_id',
      'pi.quote_id',
      'pi.purpose',
      'pi.amount',
      'pi.created_by',
      'h.reservation_id',
    ])
    .where('pi.status', '=', 'PAID')
    .where('pi.invoice_id', 'is', null)
    .orderBy('pi.paid_at', 'asc')
    .execute();
}

/**
 * A PAID receipt already on the hold for this amount+kind that no other intent
 * claims. Linking it is safer than minting a second document number for money
 * Accounts already booked.
 */
async function findUnclaimedMatchingInvoice(
  dbInstance: Kysely<Database>,
  intent: OrphanPaidIntent
): Promise<string | undefined> {
  const row = await dbInstance
    .selectFrom('invoices as i')
    .select('i.id')
    .where('i.hold_id', '=', intent.hold_id)
    .where('i.total_amount', '=', intent.amount)
    .where('i.kind', '=', intent.purpose)
    .where('i.status', '=', 'PAID')
    .where('i.deleted_at', 'is', null)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('payment_intents as pi2')
            .select(sql`1`.as('one'))
            .whereRef('pi2.invoice_id', '=', 'i.id')
        )
      )
    )
    .orderBy('i.created_at', 'asc')
    .executeTakeFirst();
  return row?.id;
}

async function linkIntentToInvoice(
  dbInstance: Kysely<Database>,
  intentId: string,
  invoiceId: string,
  userId: string
): Promise<void> {
  await dbInstance.transaction().execute(async (trx) => {
    await trx
      .updateTable('payment_intents')
      .set({ invoice_id: invoiceId, updated_by: userId, updated_at: sql`now()` })
      .where('id', '=', intentId)
      .where('invoice_id', 'is', null)
      .execute();

    await trx
      .insertInto('audit_logs')
      .values({
        request_id: null,
        user_id: userId,
        action: 'UPDATE',
        entity: 'payment_intents',
        entity_id: intentId,
        diff: { invoice_id: invoiceId, reason: 'invoice_backfill_link' },
        ip_address: null,
      })
      .execute();
  });
}

export async function runInvoiceBackfill(
  dbInstance: Kysely<Database> = defaultDb,
  options: InvoiceBackfillOptions = {},
  /** Injected in unit tests so the create/settle path can be faked without wiring quotes. */
  invoicesService?: InvoicesService
): Promise<InvoiceBackfillResult> {
  const dryRun = options.dryRun ?? true;
  const invoices = invoicesService ?? createInvoicesService(dbInstance);
  const orphans = await findOrphanPaidIntents(dbInstance);

  const result: InvoiceBackfillResult = {
    examined: orphans.length,
    linked: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const intent of orphans) {
    const base = {
      payment_intent_id: intent.id,
      amount: intent.amount,
      purpose: intent.purpose,
    };

    try {
      const existingId = await findUnclaimedMatchingInvoice(dbInstance, intent);

      if (existingId) {
        if (!dryRun) {
          await linkIntentToInvoice(dbInstance, intent.id, existingId, intent.created_by);
        }
        result.linked += 1;
        result.details.push({ ...base, action: 'link', invoice_id: existingId });
        continue;
      }

      if (dryRun) {
        result.created += 1;
        result.details.push({ ...base, action: 'create' });
        continue;
      }

      const invoice = await invoices.issueSettledInvoice(
        {
          quote_id: intent.quote_id,
          hold_id: intent.hold_id,
          reservation_id: intent.reservation_id ?? undefined,
          kind: intent.purpose,
          amount: intent.amount,
        },
        { userId: intent.created_by }
      );

      await linkIntentToInvoice(dbInstance, intent.id, invoice.id, intent.created_by);
      result.created += 1;
      result.details.push({ ...base, action: 'create', invoice_id: invoice.id });
    } catch (err) {
      result.failed += 1;
      result.details.push({
        ...base,
        action: 'fail',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  result.skipped = result.examined - result.linked - result.created - result.failed;
  return result;
}
