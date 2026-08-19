import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';

// One row per contact with the booking history the segmentation needs. Correlated
// subqueries (not a join) so multiple invoices/reservations per contact don't
// double-count. Company-wide: a customer is a customer across the whole estate
// (contacts are not property-scoped), matching how crm.contacts already behaves.
export interface CustomerStat {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  stays: string | number;             // completed/confirmed reservations
  previous_stays: string | number;    // stays migrated from Little Hotelier (count only)
  spend: string | number;             // thebe — PAID, non-refund invoices
  last_stay_days: string | number | null;  // days since last checkout, null if never
}

export class MarketingRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async customerStats(): Promise<CustomerStat[]> {
    const r = await sql<CustomerStat>`
      SELECT
        c.id, c.name, c.email, c.company, c.previous_stays,
        (SELECT COUNT(*) FROM reservations r
           WHERE r.contact_id = c.id AND r.deleted_at IS NULL
             AND r.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')) AS stays,
        (SELECT COALESCE(SUM(i.total_amount), 0) FROM invoices i
           JOIN reservations r2 ON r2.id = i.reservation_id
           WHERE r2.contact_id = c.id AND i.deleted_at IS NULL
             AND i.status = 'PAID' AND i.kind <> 'REFUND') AS spend,
        (SELECT (CURRENT_DATE - MAX(r.check_out_date)) FROM reservations r
           WHERE r.contact_id = c.id AND r.deleted_at IS NULL
             AND r.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')) AS last_stay_days
      FROM contacts c
      WHERE c.deleted_at IS NULL
    `.execute(this.db);
    return r.rows;
  }
}
