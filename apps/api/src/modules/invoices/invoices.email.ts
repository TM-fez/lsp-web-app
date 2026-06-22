// Server-side HTML for the invoice/receipt email. Inline styles only (email clients
// strip <style>). Mirrors the on-screen print document.

export interface InvoiceEmailData {
  number: string;
  kind: 'DEPOSIT' | 'BALANCE' | 'REFUND';
  status: string;
  currency: string;
  subtotal_amount: number;
  tax_rate_bps: number;
  tax_amount: number;
  total_amount: number;
  created_at: Date;
  guest_name: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  unit_code: string | null;
  unit_name: string | null;
  nights: number | null;
  unit_type: string | null;
}

const BRAND = 'Lifestyle Apartments';

const money = (thebe: number, ccy: string) =>
  `${ccy} ${(thebe / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | Date | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function docTitle(d: InvoiceEmailData): string {
  if (d.kind === 'REFUND') return 'Credit Note';
  if (d.status === 'PAID') return 'Receipt';
  return 'Invoice';
}
function lineDescription(d: InvoiceEmailData): string {
  const unit = d.unit_type ? d.unit_type.charAt(0) + d.unit_type.slice(1).toLowerCase() : 'Apartment';
  const nights = d.nights ? ` · ${d.nights} night${d.nights === 1 ? '' : 's'}` : '';
  const kind = d.kind === 'DEPOSIT' ? 'Deposit' : d.kind === 'BALANCE' ? 'Balance' : 'Refund';
  return `${kind} — ${unit} stay${nights}`;
}

export function renderInvoiceEmail(d: InvoiceEmailData): { subject: string; html: string } {
  const title = docTitle(d);
  const taxPct = Number.isInteger(d.tax_rate_bps / 100) ? String(d.tax_rate_bps / 100) : (d.tax_rate_bps / 100).toFixed(1);
  const stayLine = d.unit_code
    ? `${d.unit_name ?? d.unit_code}${d.check_in_date ? ` &nbsp;·&nbsp; ${fmtDate(d.check_in_date)} → ${fmtDate(d.check_out_date)}` : ''}`
    : '';
  const greetName = d.guest_name ? d.guest_name.split(' ')[0] : 'there';
  const paid = d.status === 'PAID';

  const html = `<div style="background:#f2ede3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#1b1815;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
    <div style="padding:24px 28px;border-bottom:1px solid #e4ddd0;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:18px;font-weight:bold;color:#22402f;">${BRAND}</td>
        <td align="right" style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8e8576;">${title}<br>
          <span style="font-size:15px;color:#1b1815;letter-spacing:0;text-transform:none;">${d.number}</span></td>
      </tr></table>
    </div>
    <div style="padding:22px 28px;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 14px;">Hi ${greetName},</p>
      <p style="margin:0 0 18px;color:#5f5e5a;">${paid ? 'Thank you — please find your receipt below.' : 'Please find your invoice below.'}</p>
      ${stayLine ? `<p style="margin:0 0 6px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8e8576;">Stay</p>
      <p style="margin:0 0 18px;">${stayLine}</p>` : ''}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4ddd0;border-bottom:1px solid #e4ddd0;">
        <tr>
          <td style="padding:12px 0;color:#1b1815;">${lineDescription(d)}</td>
          <td align="right" style="padding:12px 0;color:#1b1815;">${money(d.subtotal_amount, d.currency)}</td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:14px;">
        <tr><td style="padding:3px 0;color:#5f5e5a;">Subtotal</td><td align="right" style="color:#5f5e5a;">${money(d.subtotal_amount, d.currency)}</td></tr>
        <tr><td style="padding:3px 0;color:#5f5e5a;">VAT (${taxPct}%)</td><td align="right" style="color:#5f5e5a;">${money(d.tax_amount, d.currency)}</td></tr>
        <tr><td style="padding:10px 0 0;border-top:1px solid #d8d0c0;font-weight:bold;">Total</td>
            <td align="right" style="padding:10px 0 0;border-top:1px solid #d8d0c0;font-weight:bold;">${money(d.total_amount, d.currency)}</td></tr>
      </table>
      ${paid ? `<p style="margin:20px 0 0;"><span style="display:inline-block;border:2px solid #1c3527;color:#1c3527;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Paid</span></p>` : ''}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #e4ddd0;font-size:12px;color:#8e8576;">
      Thank you for staying with ${BRAND}, Gaborone. All amounts in ${d.currency}.
    </div>
  </div>
</div>`;

  return { subject: `${title} ${d.number} — ${BRAND}`, html };
}
