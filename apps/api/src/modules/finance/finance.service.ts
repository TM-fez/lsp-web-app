import { FinanceRepository } from './finance.repository.js';
import type {
  AgingBucket, AgingBucketKey, FinanceCockpit, FinanceQuery, OutstandingInvoice, PropertyReceivable,
} from './finance.types.js';

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const BUCKET_ORDER: AgingBucketKey[] = ['0-30', '31-60', '61-90', '90+'];
const UNATTRIBUTED = 'Unattributed';

export class FinanceService {
  constructor(private readonly repo: FinanceRepository) {}

  /** Real-time receivables snapshot, scoped to the caller's accessible properties. */
  async getCockpit(query: FinanceQuery): Promise<FinanceCockpit> {
    const [summary, agingRows, propRows, invoiceRows] = await Promise.all([
      this.repo.summary(query),
      this.repo.aging(query),
      this.repo.byProperty(query),
      this.repo.outstanding(query),
    ]);

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
    }));

    return {
      as_of: new Date().toISOString(),
      summary: {
        total_receivable: num(summary.total_receivable),
        open_invoices: num(summary.open_invoices),
        oldest_days: num(summary.oldest_days),
        refunds_payable: num(summary.refunds_payable),
      },
      aging,
      by_property,
      invoices,
    };
  }
}
