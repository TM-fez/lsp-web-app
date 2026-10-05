import { describe, it, expect } from 'vitest';
import { pnlCsvRows } from './csv';
import type { ReportsResponse } from '@/types';

const data = {
  summary: {
    from: '2026-09-01', to: '2026-09-30', revenue_basis: 'ACCRUAL', revenue: 100_000,
    maintenance_cost: 0, operating_expenses: 0, total_cost: 0, net: 100_000, margin_pct: 100,
    vat_output: 14_000, reservations: 1, room_nights_booked: 1, room_nights_available: 30, occupancy_pct: 3.3,
  },
  monthly: [{ month: '2026-09', revenue: 100_000, maintenance_cost: 0, operating_expenses: 0, net: 100_000 }],
  by_property: [],
  scope_note: null,
} as unknown as ReportsResponse;

// (R6 item 20) Reports count revenue before VAT (owner, round 4), but the CSV just said
// "Revenue" — an accountant reading it alone would take it as gross.
describe('P&L CSV labels', () => {
  it('says revenue is before VAT and which basis it is on', () => {
    const rows = pnlCsvRows(data, '2026-09-01', '2026-09-30');
    expect(rows).toContain('Basis,Earned (accrual)');
    expect(rows).toContain('Revenue (excl. VAT),1000.00');
    expect(rows).toContain('VAT (output) on revenue earned,140.00');
    expect(rows).toContain('Month,Revenue (excl. VAT),Maintenance,Operating,Net');
  });

  it('names the cash basis on a cash report', () => {
    const rows = pnlCsvRows({ ...data, summary: { ...data.summary, revenue_basis: 'CASH' } }, 'a', 'b');
    expect(rows).toContain('Basis,Received (cash)');
    expect(rows).toContain('VAT (output) on money received,140.00');
  });
});
