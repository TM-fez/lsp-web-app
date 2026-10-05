import type { ReportsResponse } from '@/types';
import { csvCell, downloadCsv } from '@/lib/utils/csv';
import { toast } from '@/store/toast';

const cell = csvCell;
const pula = (thebe: number) => (thebe / 100).toFixed(2);

/** Build + download a P&L CSV (summary, monthly series, per-property) for accountants. */
export function downloadPnlCsv(data: ReportsResponse, from: string, to: string): void {
  // (R5 retest) A tester saw no "Saved …csv" for one role and nothing else either. Whatever
  // the cause, building the file must never fail silently: say so, so they can retry.
  try {
    buildAndSave(data, from, to);
  } catch {
    toast.error('Couldn’t build the CSV for this period — refresh the report and try again.');
  }
}

function buildAndSave(data: ReportsResponse, from: string, to: string): void {
  downloadCsv(`lsp-pnl-${from}-to-${to}.csv`, pnlCsvRows(data, from, to));
}

/**
 * The CSV's lines. (R6 item 20) Revenue is before VAT on both bases (owner, round 4) and the
 * VAT line follows the basis, so the file says both — it is often read without the screen.
 */
export function pnlCsvRows(data: ReportsResponse, from: string, to: string): string[] {
  const s = data.summary;
  const cash = s.revenue_basis === 'CASH';
  return [
    `Lifestyle Apartments — Profit & Loss`,
    `Period,${from} to ${to}`,
    `Basis,${cash ? 'Received (cash)' : 'Earned (accrual)'}`,
    '',
    'Summary,Amount (BWP)',
    `Revenue (excl. VAT),${pula(s.revenue)}`,
    `Maintenance cost,${pula(s.maintenance_cost)}`,
    `Operating expenses,${pula(s.operating_expenses)}`,
    `Total cost,${pula(s.total_cost)}`,
    `Net,${pula(s.net)}`,
    `Margin %,${s.margin_pct}`,
    `VAT (output) on ${cash ? 'money received' : 'revenue earned'},${pula(s.vat_output)}`,
    `Occupancy %,${s.occupancy_pct}`,
    '',
    'Month,Revenue (excl. VAT),Maintenance,Operating,Net',
    ...(data.monthly ?? []).map((m) => [m.month, pula(m.revenue), pula(m.maintenance_cost), pula(m.operating_expenses), pula(m.net)].join(',')),
    '',
    'Property,Revenue (excl. VAT),Maintenance,Operating,Net,Occupancy %',
    ...(data.by_property ?? []).map((p) =>
      [cell(p.property_name), pula(p.revenue), pula(p.maintenance_cost), pula(p.operating_expenses), pula(p.net), p.occupancy_pct ?? ''].join(','),
    ),
  ];
}
