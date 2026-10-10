import { FinanceRepository } from './finance.repository.js';
import type {
  AgingBucket, AgingBucketKey, FinanceCockpit, HeldOnCancelled, FinanceQuery, OutstandingInvoice, PropertyReceivable,
} from './finance.types.js';

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const BUCKET_ORDER: AgingBucketKey[] = ['0-30', '31-60', '61-90', '90+'];
const UNATTRIBUTED = 'Unattributed';

export class FinanceService {
  constructor(private readonly repo: FinanceRepository) {}

  /** Cancelled / no-show bookings that still hold the guest's money — surfaced, never auto-refunded. */
  async heldOnCancelled(query: FinanceQuery): Promise<HeldOnCancelled> {
    const rows = await this.repo.heldOnCancelled(query);
    return {
      as_of: new Date().toISOString(),
      total_held: rows.reduce((sum, r) => sum + r.received, 0),
      count: rows.length,
      rows,
      note: 'These bookings are cancelled but the guest’s money is still with us. Nothing is refunded automatically — decide each one (refund, or keep with a reason).',
    };
  }

  /** Real-time receivables snapshot, scoped to the caller's ACTIVE property. */
  async getCockpit(query: FinanceQuery): Promise<FinanceCockpit> {
    // (Post-launch) One snapshot for all four reads, so the headline always equals the rows
    // beneath it even while invoices are being raised (FinanceRepository.snapshot).
    const [summary, agingRows, propRows, invoiceRows] = await this.repo.snapshot((repo) =>
      Promise.all([repo.summary(query), repo.aging(query), repo.byProperty(query), repo.outstanding(query)])
    );

    // Fill the fixed four-bucket shape; the query only returns non-empty buckets.
    const byBucket = new Map(agingRows.map((r) => [r.bucket, r]));
    const aging: AgingBucket[] = BUCKET_ORDER.map((bucket) => {
      const row = byBucket.get(bucket);
      return { bucket, amount: num(row?.amount), count: num(row?.count) };
    });

    const by_property: PropertyReceivable[] = propRows.map((r) => ({
      property_id: r.property_id,
      property_name: r.property_name ?? UNATTRIBUTED,
      amount: num(r.amount),
      count: num(r.count),
    }));

    const invoices: OutstandingInvoice[] = invoiceRows.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      status: r.status,
      total_amount: num(r.total_amount),
      currency: r.currency,
      bill_to_name: r.bill_to_name,
      property_id: r.property_id,
      property_name: r.property_name,
      created_at: r.created_at.toISOString(),
      days_outstanding: num(r.days_outstanding),
      due_date: r.due_date,
      days_overdue: num(r.days_overdue),
    }));

    return {
      as_of: new Date().toISOString(),
      summary: {
        total_receivable: num(summary.total_receivable),
        open_invoices: num(summary.open_invoices),
        oldest_days: num(summary.oldest_days),
        refunds_payable: num(summary.refunds_payable),
        overdue_amount: num(summary.overdue_amount),
        overdue_count: num(summary.overdue_count),
      },
      aging,
      by_property,
      invoices,
    };
  }
}
