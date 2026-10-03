import { Kysely, sql } from 'kysely';
import type { Database, InvoiceRow, NewInvoice } from '../../db/types.js';
import { allocateDocumentNumber } from '../../core/documents/numbering.js';
import { todayInPropertyTZ } from '../../core/time.js';
import {
  agreedTotal,
  lockReservation,
  paidToDate,
  OPEN_INVOICE_STATUSES,
  TERMINAL_RESERVATION_STATUSES,
} from '../../core/money/folio.js';
import { splitInclusive } from '../quotes/quotes.util.js';
import { computeDueDate } from './invoices.due.js';
import type { InvoiceRequestMeta } from './invoices.types.js';

/**
 * ── The receivable: what a booking still owes, as invoices. ───────────────────────────
 *
 * THE INVARIANT this file exists to keep true, for every live booking whose price has
 * been agreed:
 *
 *     the booking has AT MOST ONE open invoice, and it is for exactly what the folio
 *     says is outstanding  (agreed total − received).
 *
 * Before it, every payment raised a PAID receipt AND a fresh ISSUED invoice "for the
 * remainder", priced off a live re-quote, and never retired the previous one: pay P500
 * of P4,500 → ISSUED 4,000; pay P1,000 more → a second ISSUED 3,500 on top of the first.
 * Finance showed P7,500 owed against a true P3,000, and settling the stale one collected
 * the money twice. Nothing could be voided, so nothing could be corrected.
 *
 * So the open invoice is not raised per payment — it is RECONCILED to the folio after
 * every event that moves money or the agreement (a payment, a refund, a pay-later
 * confirm, a cancellation, a settle). `planReceivable` is the pure decision;
 * `reconcileReceivable` applies it inside the caller's transaction.
 *
 * PARTIALLY_PAID (previously "a status nothing writes", D04) is now real, with one
 * precise meaning: an OPEN invoice on a booking that has already had money received
 * against it. Nothing is stored on the invoice for it — it is stamped by the same
 * reconcile that sizes the invoice, so it can never disagree with the folio.
 *
 * Money axis only: nothing in here may be imported by availability / overlap /
 * channel-export code (CLAUDE.md invariant 7).
 */

export type OpenInvoiceStatus = (typeof OPEN_INVOICE_STATUSES)[number];

export interface OpenInvoiceLite {
  id: string;
  total_amount: number;
  status: OpenInvoiceStatus;
}

export type ReceivableAction =
  | { type: 'void'; id: string; from_total: number }
  | { type: 'resize'; id: string; from_total: number; total: number; from_status: OpenInvoiceStatus; status: OpenInvoiceStatus }
  | { type: 'create'; total: number; status: OpenInvoiceStatus };

/**
 * Decide what has to change so the booking's open invoices equal its outstanding.
 * Pure — no I/O — so the arithmetic is unit-testable without a database.
 *
 * @param total    agreed total in thebe, or null when nothing says (→ do nothing)
 * @param paid     received so far, net of refunds
 * @param terminal booking is CANCELLED / NO_SHOW: nothing more is owed, whatever the folio says
 * @param open     the booking's open invoices, OLDEST FIRST — the oldest is kept so the
 *                 ageing clock and due date survive a part payment
 */
export function planReceivable(args: {
  total: number | null;
  paid: number;
  terminal: boolean;
  open: OpenInvoiceLite[];
}): ReceivableAction[] {
  if (args.total == null) return [];

  const outstanding = args.terminal ? 0 : Math.max(0, args.total - args.paid);
  const status: OpenInvoiceStatus = args.paid > 0 ? 'PARTIALLY_PAID' : 'ISSUED';

  if (outstanding === 0) {
    return args.open.map((o) => ({ type: 'void', id: o.id, from_total: o.total_amount }));
  }

  const [keep, ...surplus] = args.open;
  const actions: ReceivableAction[] = surplus.map((o) => ({
    type: 'void',
    id: o.id,
    from_total: o.total_amount,
  }));

  if (!keep) {
    actions.push({ type: 'create', total: outstanding, status });
  } else if (keep.total_amount !== outstanding || keep.status !== status) {
    actions.push({
      type: 'resize',
      id: keep.id,
      from_total: keep.total_amount,
      total: outstanding,
      from_status: keep.status,
      status,
    });
  }
  return actions;
}

type UnnumberedInvoice = Omit<NewInvoice, 'number'>;

/**
 * Insert an invoice with the next gapless number and its audit row — in the CALLER's
 * transaction (D09: the number is allocated in the same transaction as the insert, so a
 * rollback takes the counter back with it).
 *
 * Fills `due_date` for everything but a refund credit note unless the caller set one.
 */
export async function insertInvoice(
  trx: Kysely<Database>,
  invoice: UnnumberedInvoice,
  meta: InvoiceRequestMeta,
  opts: { checkInDay?: string | null } = {}
): Promise<InvoiceRow> {
  const number = await allocateDocumentNumber(trx, 'INV');
  const due_date =
    invoice.due_date !== undefined
      ? invoice.due_date
      : invoice.kind === 'REFUND'
        ? null
        : computeDueDate({ issuedOn: todayInPropertyTZ(), checkInDay: opts.checkInDay });

  const inserted = await trx
    .insertInto('invoices')
    .values({ ...invoice, due_date, number })
    .returningAll()
    .executeTakeFirstOrThrow();

  await trx.insertInto('audit_logs').values({
    request_id: meta.requestId ?? null,
    user_id: meta.userId,
    action: 'CREATE',
    entity: 'invoices',
    entity_id: inserted.id,
    diff: inserted,
    ip_address: meta.ip ?? null,
  }).execute();

  return inserted;
}

export interface ReceiptInput {
  reservationId: string | null;
  holdId: string | null;
  quoteId: string | null;
  kind: 'DEPOSIT' | 'BALANCE';
  /** Thebe actually received. */
  amount: number;
  taxRateBps: number;
  currency: string;
  checkInDay?: string | null;
}

/**
 * Raise a PAID receipt for money that has ALREADY arrived — one insert, born PAID.
 *
 * It used to be issueInvoice() (an ISSUED row) followed by settle() in a second
 * transaction, and the comment on it admitted a crash between the two left an ISSUED
 * invoice for money in hand. Born PAID there is no in-between state to crash into.
 */
export async function insertReceipt(
  trx: Kysely<Database>,
  receipt: ReceiptInput,
  meta: InvoiceRequestMeta
): Promise<InvoiceRow> {
  const { subtotal, tax } = splitInclusive(receipt.amount, receipt.taxRateBps);
  return insertInvoice(
    trx,
    {
      hold_id: receipt.holdId,
      quote_id: receipt.quoteId,
      reservation_id: receipt.reservationId,
      kind: receipt.kind,
      currency: receipt.currency,
      subtotal_amount: subtotal,
      tax_rate_bps: receipt.taxRateBps,
      tax_amount: tax,
      total_amount: receipt.amount,
      status: 'PAID',
      issued_by: meta.userId,
      created_by: meta.userId,
      updated_by: meta.userId,
    },
    meta,
    { checkInDay: receipt.checkInDay }
  );
}

export interface ReconcileOptions {
  /** Tax rate for a NEW open invoice when the booking has none to copy it from. */
  taxRateBps?: number;
  currency?: string;
  quoteId?: string | null;
  holdId?: string | null;
}

export interface ReconcileResult {
  /** True when the booking has no agreed total, so nothing could be reconciled. */
  skipped: boolean;
  total: number | null;
  paid: number;
  outstanding: number;
  actions: ReceivableAction[];
}

/**
 * Bring a booking's open invoices in line with its folio, inside the CALLER's
 * transaction. The caller must already hold the reservation lock (lockReservation) —
 * this reads the folio and writes invoices on the strength of it.
 *
 * Retires (VOID, never delete — the number stays in the gapless series) any surplus open
 * invoice, resizes the oldest in place, or raises one when there is none.
 */
export async function reconcileReceivable(
  trx: Kysely<Database>,
  reservationId: string,
  meta: InvoiceRequestMeta,
  opts: ReconcileOptions = {}
): Promise<ReconcileResult> {
  const reservation = await lockReservation(trx, reservationId);
  if (!reservation || reservation.status === 'BLOCKED') {
    // An imported OTA block has no guest and no money owed through LSP.
    return { skipped: true, total: null, paid: 0, outstanding: 0, actions: [] };
  }

  const total = await agreedTotal(trx, reservation);
  const paid = (await paidToDate(trx, [reservationId])).get(reservationId) ?? 0;
  const terminal = (TERMINAL_RESERVATION_STATUSES as readonly string[]).includes(reservation.status);

  const open = await trx
    .selectFrom('invoices')
    .select(['id', 'total_amount', 'status', 'tax_rate_bps', 'currency', 'quote_id', 'hold_id'])
    .where('reservation_id', '=', reservationId)
    .where('deleted_at', 'is', null)
    .where('kind', '<>', 'REFUND')
    .where('status', 'in', [...OPEN_INVOICE_STATUSES])
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();

  const actions = planReceivable({
    total,
    paid,
    terminal,
    open: open.map((o) => ({
      id: o.id,
      total_amount: o.total_amount,
      status: o.status as OpenInvoiceStatus,
    })),
  });

  const outstanding = total == null || terminal ? 0 : Math.max(0, total - paid);
  if (actions.length === 0) {
    return { skipped: total == null, total, paid, outstanding, actions };
  }

  // Tax for a new invoice: what the booking's earlier invoices charged, else the caller's
  // rate, else none. Never guessed from today's rate plan — that moves.
  const earlier = open[0] ?? (await latestInvoiceTerms(trx, reservationId));
  const taxRateBps = earlier?.tax_rate_bps ?? opts.taxRateBps ?? 0;
  const currency = earlier?.currency ?? opts.currency ?? reservation.folio_currency;

  for (const action of actions) {
    if (action.type === 'void') {
      await trx
        .updateTable('invoices')
        .set({ status: 'VOID', updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', action.id)
        .execute();
      await auditInvoice(trx, meta, action.id, {
        status: 'VOID',
        reason: terminal ? 'booking_cancelled' : 'receivable_reconciled',
        total_amount: action.from_total,
      });
    } else if (action.type === 'resize') {
      const { subtotal, tax } = splitInclusive(action.total, taxRateBps);
      await trx
        .updateTable('invoices')
        .set({
          total_amount: action.total,
          subtotal_amount: subtotal,
          tax_amount: tax,
          status: action.status,
          updated_by: meta.userId,
          updated_at: sql`now()`,
        })
        .where('id', '=', action.id)
        .execute();
      await auditInvoice(trx, meta, action.id, {
        reason: 'receivable_reconciled',
        total_amount: { from: action.from_total, to: action.total },
        status: { from: action.from_status, to: action.status },
      });
    } else {
      const { subtotal, tax } = splitInclusive(action.total, taxRateBps);
      await insertInvoice(
        trx,
        {
          hold_id: opts.holdId ?? null,
          quote_id: opts.quoteId ?? null,
          reservation_id: reservationId,
          kind: 'BALANCE',
          currency,
          subtotal_amount: subtotal,
          tax_rate_bps: taxRateBps,
          tax_amount: tax,
          total_amount: action.total,
          status: action.status,
          issued_by: meta.userId,
          created_by: meta.userId,
          updated_by: meta.userId,
        },
        meta,
        { checkInDay: reservation.check_in_day }
      );
    }
  }

  return { skipped: false, total, paid, outstanding, actions };
}

async function latestInvoiceTerms(trx: Kysely<Database>, reservationId: string) {
  return trx
    .selectFrom('invoices')
    .select(['tax_rate_bps', 'currency'])
    .where('reservation_id', '=', reservationId)
    .where('deleted_at', 'is', null)
    .where('kind', '<>', 'REFUND')
    .where('status', '<>', 'VOID')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
}

async function auditInvoice(
  trx: Kysely<Database>,
  meta: InvoiceRequestMeta,
  invoiceId: string,
  diff: Record<string, unknown>
): Promise<void> {
  await trx.insertInto('audit_logs').values({
    request_id: meta.requestId ?? null,
    user_id: meta.userId,
    action: 'UPDATE',
    entity: 'invoices',
    entity_id: invoiceId,
    diff,
    ip_address: meta.ip ?? null,
  }).execute();
}
