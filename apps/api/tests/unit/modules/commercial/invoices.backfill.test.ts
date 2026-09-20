/**
 * Invoice backfill — unit coverage for the dry-run / link / create decisions.
 *
 * The live-DB path (allocateDocumentNumber + audit txn) is exercised by the
 * commercial integration suites; this file pins the *policy* the CLI is meant
 * to enforce so a future change cannot quietly mint duplicate PAID receipts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runInvoiceBackfill } from '../../../../src/modules/invoices/invoices.backfill.js';
import type { InvoicesService } from '../../../../src/modules/invoices/invoices.service.js';

type IntentRow = {
  id: string;
  hold_id: string;
  quote_id: string;
  purpose: 'DEPOSIT' | 'BALANCE';
  amount: number;
  created_by: string;
  reservation_id: string | null;
};

/**
 * Minimal Kysely stand-in. The backfill issues three shapes of query:
 *   1. selectFrom…execute()           → orphan paid intents
 *   2. selectFrom…executeTakeFirst()  → unclaimed matching invoice
 *   3. transaction().execute(fn)      → link invoice_id + audit row
 */
function makeDb(opts: {
  orphans: IntentRow[];
  /** Per-call answers for the match lookup (undefined = no match). */
  matches?: Array<string | undefined>;
}) {
  const matchQueue = [...(opts.matches ?? [])];

  const selectChain = {
    leftJoin: vi.fn(() => selectChain),
    select: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    whereRef: vi.fn(() => selectChain),
    orderBy: vi.fn(() => selectChain),
    execute: vi.fn(async () => opts.orphans),
    executeTakeFirst: vi.fn(async () => {
      const next = matchQueue.length > 0 ? matchQueue.shift() : undefined;
      return next ? { id: next } : undefined;
    }),
  };

  const trxChain = {
    updateTable: vi.fn(() => trxChain),
    set: vi.fn(() => trxChain),
    where: vi.fn(() => trxChain),
    insertInto: vi.fn(() => trxChain),
    values: vi.fn(() => trxChain),
    execute: vi.fn(async () => undefined),
  };

  return {
    selectFrom: vi.fn(() => selectChain),
    transaction: vi.fn(() => ({
      execute: vi.fn(async (fn: (trx: unknown) => Promise<unknown>) => fn(trxChain)),
    })),
    _select: selectChain,
    _trx: trxChain,
  } as never;
}

describe('runInvoiceBackfill', () => {
  const orphan: IntentRow = {
    id: 'pi-1',
    hold_id: 'h-1',
    quote_id: 'q-1',
    purpose: 'DEPOSIT',
    amount: 25_700,
    created_by: 'u-1',
    reservation_id: 'r-1',
  };

  let issueSettledInvoice: ReturnType<typeof vi.fn>;
  let invoices: InvoicesService;

  beforeEach(() => {
    issueSettledInvoice = vi.fn().mockResolvedValue({ id: 'inv-new', status: 'PAID' });
    invoices = { issueSettledInvoice } as unknown as InvoicesService;
  });

  it('dry-run by default: counts a create without writing', async () => {
    const db = makeDb({ orphans: [orphan] });
    const result = await runInvoiceBackfill(db, {}, invoices);
    expect(result.examined).toBe(1);
    expect(result.created).toBe(1);
    expect(result.linked).toBe(0);
    expect(issueSettledInvoice).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('links an unclaimed matching PAID invoice instead of minting a duplicate', async () => {
    const db = makeDb({ orphans: [orphan], matches: ['inv-existing'] });
    const result = await runInvoiceBackfill(db, { dryRun: false }, invoices);
    expect(result.linked).toBe(1);
    expect(result.created).toBe(0);
    expect(issueSettledInvoice).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalled();
    expect(result.details[0]).toMatchObject({
      action: 'link',
      invoice_id: 'inv-existing',
      amount: 25_700,
    });
  });

  it('creates a settled receipt and links it when nothing matches', async () => {
    const db = makeDb({ orphans: [orphan] });
    const result = await runInvoiceBackfill(db, { dryRun: false }, invoices);
    expect(result.created).toBe(1);
    expect(issueSettledInvoice).toHaveBeenCalledWith(
      {
        quote_id: 'q-1',
        hold_id: 'h-1',
        reservation_id: 'r-1',
        kind: 'DEPOSIT',
        amount: 25_700,
      },
      { userId: 'u-1' }
    );
    expect(db.transaction).toHaveBeenCalled();
    expect(result.details[0]).toMatchObject({ action: 'create', invoice_id: 'inv-new' });
  });

  it('records a failure without aborting the rest of the run', async () => {
    issueSettledInvoice.mockRejectedValueOnce(new Error('quote gone'));
    const second: IntentRow = { ...orphan, id: 'pi-2', amount: 10_000 };
    const db = makeDb({ orphans: [orphan, second], matches: [undefined, 'inv-2'] });

    const result = await runInvoiceBackfill(db, { dryRun: false }, invoices);
    expect(result.failed).toBe(1);
    expect(result.linked).toBe(1);
    expect(result.details.find((d) => d.action === 'fail')?.reason).toMatch(/quote gone/);
  });
});
