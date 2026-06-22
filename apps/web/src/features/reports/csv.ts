import type { ReportsResponse } from '@/types';

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const pula = (thebe: number) => (thebe / 100).toFixed(2);

/** Build + download a P&L CSV (summary, monthly series, per-property) for accountants. */
export function downloadPnlCsv(data: ReportsResponse, from: string, to: string): void {
  const s = data.summary;
  const rows: string[] = [
    `Lifestyle Apartments — Profit & Loss`,
    `Period,${from} to ${to}`,
    '',
    'Summary,Amount (BWP)',
    `Revenue,${pula(s.revenue)}`,
    `Maintenance cost,${pula(s.maintenance_cost)}`,
    `Operating expenses,${pula(s.operating_expenses)}`,
    `Total cost,${pula(s.total_cost)}`,
    `Net,${pula(s.net)}`,
    `Margin %,${s.margin_pct}`,
    `VAT collected (output),${pula(s.vat_output)}`,
    `Occupancy %,${s.occupancy_pct}`,
    '',
    'Month,Revenue,Maintenance,Operating,Net',
    ...data.monthly.map((m) => [m.month, pula(m.revenue), pula(m.maintenance_cost), pula(m.operating_expenses), pula(m.net)].join(',')),
    '',
    'Property,Revenue,Maintenance,Operating,Net,Occupancy %',
    ...data.by_property.map((p) =>
      [cell(p.property_name), pula(p.revenue), pula(p.maintenance_cost), pula(p.operating_expenses), pula(p.net), p.occupancy_pct ?? ''].join(','),
    ),
  ];

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lsp-pnl-${from}-to-${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
