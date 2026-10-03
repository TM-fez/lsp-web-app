import { describe, it, expect } from 'vitest';
import { planReceivable, type OpenInvoiceLite } from '../../../../src/modules/invoices/invoices.receivable.js';

const open = (id: string, total: number, status: OpenInvoiceLite['status'] = 'ISSUED'): OpenInvoiceLite => ({
  id, total_amount: total, status,
});

/**
 * planReceivable is the arithmetic behind "open receivables == folio outstanding": the pure
 * decision of what to void / resize / raise so a booking has AT MOST ONE open invoice and it
 * equals agreed total − received. The DB-backed behaviour is in stage1-money.test.ts.
 */
describe('planReceivable', () => {
  it('does nothing when the booking has no agreed price (it must never invent a number)', () => {
    expect(planReceivable({ total: null, paid: 0, terminal: false, open: [] })).toEqual([]);
    expect(planReceivable({ total: null, paid: 5_000, terminal: false, open: [open('a', 100)] })).toEqual([]);
  });

  it('raises one ISSUED invoice for the whole stay when nothing has been paid', () => {
    expect(planReceivable({ total: 300_000, paid: 0, terminal: false, open: [] })).toEqual([
      { type: 'create', total: 300_000, status: 'ISSUED' },
    ]);
  });

  it('raises a PARTIALLY_PAID invoice for the remainder once money has arrived', () => {
    expect(planReceivable({ total: 300_000, paid: 100_000, terminal: false, open: [] })).toEqual([
      { type: 'create', total: 200_000, status: 'PARTIALLY_PAID' },
    ]);
  });

  it('is a no-op when the open invoice already equals the outstanding', () => {
    expect(planReceivable({ total: 300_000, paid: 100_000, terminal: false, open: [open('a', 200_000, 'PARTIALLY_PAID')] })).toEqual([]);
    expect(planReceivable({ total: 300_000, paid: 0, terminal: false, open: [open('a', 300_000, 'ISSUED')] })).toEqual([]);
  });

  it('resizes the existing invoice in place after a part payment (and stamps PARTIALLY_PAID)', () => {
    expect(planReceivable({ total: 300_000, paid: 100_000, terminal: false, open: [open('a', 300_000, 'ISSUED')] })).toEqual([
      { type: 'resize', id: 'a', from_total: 300_000, total: 200_000, from_status: 'ISSUED', status: 'PARTIALLY_PAID' },
    ]);
  });

  it('corrects the status alone when the amount is right but the label is stale', () => {
    const [action] = planReceivable({ total: 300_000, paid: 100_000, terminal: false, open: [open('a', 200_000, 'ISSUED')] });
    expect(action).toMatchObject({ type: 'resize', id: 'a', total: 200_000, status: 'PARTIALLY_PAID' });
  });

  it('keeps the OLDEST open invoice and voids the stacked surplus — the legacy double-count', () => {
    // 300k stay, 150k paid; the old code left 250k and 150k both ISSUED (400k "owed" vs 150k real).
    const actions = planReceivable({
      total: 300_000, paid: 150_000, terminal: false,
      open: [open('old', 250_000), open('newer', 150_000)],
    });
    expect(actions).toEqual([
      { type: 'void', id: 'newer', from_total: 150_000 },
      { type: 'resize', id: 'old', from_total: 250_000, total: 150_000, from_status: 'ISSUED', status: 'PARTIALLY_PAID' },
    ]);
  });

  it('voids every open invoice once the booking is paid in full', () => {
    expect(planReceivable({ total: 300_000, paid: 300_000, terminal: false, open: [open('a', 1), open('b', 2)] })).toEqual([
      { type: 'void', id: 'a', from_total: 1 },
      { type: 'void', id: 'b', from_total: 2 },
    ]);
  });

  it('treats an overpaid booking as owing nothing (never a negative debt)', () => {
    expect(planReceivable({ total: 100_000, paid: 130_000, terminal: false, open: [open('a', 5_000)] })).toEqual([
      { type: 'void', id: 'a', from_total: 5_000 },
    ]);
    expect(planReceivable({ total: 100_000, paid: 130_000, terminal: false, open: [] })).toEqual([]);
  });

  it('voids everything when the booking has ended, whatever the folio says', () => {
    expect(planReceivable({ total: 300_000, paid: 0, terminal: true, open: [open('a', 300_000)] })).toEqual([
      { type: 'void', id: 'a', from_total: 300_000 },
    ]);
    // …and raises nothing for a cancelled booking that has no invoice.
    expect(planReceivable({ total: 300_000, paid: 0, terminal: true, open: [] })).toEqual([]);
  });

  it('is idempotent: applying the plan and planning again yields nothing', () => {
    const first = planReceivable({ total: 300_000, paid: 100_000, terminal: false, open: [open('a', 300_000), open('b', 50_000)] });
    expect(first.length).toBeGreaterThan(0);
    expect(planReceivable({ total: 300_000, paid: 100_000, terminal: false, open: [open('a', 200_000, 'PARTIALLY_PAID')] })).toEqual([]);
  });
});
