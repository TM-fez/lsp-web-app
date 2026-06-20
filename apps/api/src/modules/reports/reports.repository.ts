import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';

export interface RepoWindow {
  from: string;     // YYYY-MM-DD inclusive
  toExcl: string;   // YYYY-MM-DD exclusive upper bound
  propertyId?: string;
}

interface MonthAmount { month: string; amount: string | number | null }
interface PropAmount { property_id: string | null; property_name: string | null; amount: string | number | null }

// Optional "AND p.id = …" fragment, safely parameterised.
const byProp = (id?: string) => (id ? sql`AND p.id = ${id}` : sql``);

// Month labels + window filters are pinned to UTC (the seed/business dates are UTC
// midnights). The DB session timezone is Africa/Gaborone, so reading a timestamptz
// `date_trunc` back as UTC would shift month boundaries — `AT TIME ZONE 'UTC'` keeps
// the wall-clock in UTC on both the label and the comparison.

export class ReportsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // ── Revenue (PAID invoices, refunds negative; recognised at invoice date) ─────
  async revenueByMonth(w: RepoWindow): Promise<MonthAmount[]> {
    const r = await sql<MonthAmount>`
      SELECT to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
             SUM(CASE WHEN i.kind = 'REFUND' THEN -i.total_amount ELSE i.total_amount END) AS amount
      FROM invoices i
      LEFT JOIN reservations rsv ON rsv.id = i.reservation_id
      LEFT JOIN rooms rm ON rm.id = rsv.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE i.status = 'PAID' AND i.deleted_at IS NULL
        AND (i.created_at AT TIME ZONE 'UTC') >= ${w.from}::timestamp
        AND (i.created_at AT TIME ZONE 'UTC') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId)}
      GROUP BY 1 ORDER BY 1
    `.execute(this.db);
    return r.rows;
  }

  async revenueByProperty(w: RepoWindow): Promise<PropAmount[]> {
    const r = await sql<PropAmount>`
      SELECT p.id AS property_id, p.name AS property_name,
             SUM(CASE WHEN i.kind = 'REFUND' THEN -i.total_amount ELSE i.total_amount END) AS amount
      FROM invoices i
      LEFT JOIN reservations rsv ON rsv.id = i.reservation_id
      LEFT JOIN rooms rm ON rm.id = rsv.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE i.status = 'PAID' AND i.deleted_at IS NULL
        AND (i.created_at AT TIME ZONE 'UTC') >= ${w.from}::timestamp
        AND (i.created_at AT TIME ZONE 'UTC') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId)}
      GROUP BY 1, 2
    `.execute(this.db);
    return r.rows;
  }

  // Output VAT collected (tax on PAID invoices, refunds negative) — for BURS returns.
  async vatOutput(w: RepoWindow): Promise<string | number | null> {
    const r = await sql<{ vat: string | number | null }>`
      SELECT SUM(CASE WHEN i.kind = 'REFUND' THEN -i.tax_amount ELSE i.tax_amount END) AS vat
      FROM invoices i
      LEFT JOIN reservations rsv ON rsv.id = i.reservation_id
      LEFT JOIN rooms rm ON rm.id = rsv.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE i.status = 'PAID' AND i.deleted_at IS NULL
        AND (i.created_at AT TIME ZONE 'UTC') >= ${w.from}::timestamp
        AND (i.created_at AT TIME ZONE 'UTC') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId)}`.execute(this.db);
    return r.rows[0]?.vat ?? 0;
  }

  // ── Maintenance / contractor cost (approved spend, by opened date) ────────────
  async maintenanceByMonth(w: RepoWindow): Promise<MonthAmount[]> {
    const r = await sql<MonthAmount>`
      SELECT to_char(wo.opened_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, SUM(wo.cost_amount) AS amount
      FROM maintenance_work_orders wo
      LEFT JOIN rooms rm ON rm.id = wo.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE wo.cost_amount IS NOT NULL AND wo.cost_approved_at IS NOT NULL AND wo.deleted_at IS NULL
        AND (wo.opened_at AT TIME ZONE 'UTC') >= ${w.from}::timestamp
        AND (wo.opened_at AT TIME ZONE 'UTC') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId)}
      GROUP BY 1 ORDER BY 1
    `.execute(this.db);
    return r.rows;
  }

  async maintenanceByProperty(w: RepoWindow): Promise<PropAmount[]> {
    const r = await sql<PropAmount>`
      SELECT p.id AS property_id, p.name AS property_name, SUM(wo.cost_amount) AS amount
      FROM maintenance_work_orders wo
      LEFT JOIN rooms rm ON rm.id = wo.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE wo.cost_amount IS NOT NULL AND wo.cost_approved_at IS NOT NULL AND wo.deleted_at IS NULL
        AND (wo.opened_at AT TIME ZONE 'UTC') >= ${w.from}::timestamp
        AND (wo.opened_at AT TIME ZONE 'UTC') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId)}
      GROUP BY 1, 2
    `.execute(this.db);
    return r.rows;
  }

  // ── Operating expenses (the ledger, by incurred date — a plain DATE) ──────────
  async opexByMonth(w: RepoWindow): Promise<MonthAmount[]> {
    const r = await sql<MonthAmount>`
      SELECT to_char(oe.incurred_on, 'YYYY-MM') AS month, SUM(oe.amount) AS amount
      FROM operating_expenses oe
      LEFT JOIN properties p ON p.id = oe.property_id
      WHERE oe.deleted_at IS NULL
        AND oe.incurred_on >= ${w.from}::date AND oe.incurred_on < ${w.toExcl}::date
        ${byProp(w.propertyId)}
      GROUP BY 1 ORDER BY 1
    `.execute(this.db);
    return r.rows;
  }

  async opexByProperty(w: RepoWindow): Promise<PropAmount[]> {
    const r = await sql<PropAmount>`
      SELECT p.id AS property_id, p.name AS property_name, SUM(oe.amount) AS amount
      FROM operating_expenses oe
      LEFT JOIN properties p ON p.id = oe.property_id
      WHERE oe.deleted_at IS NULL
        AND oe.incurred_on >= ${w.from}::date AND oe.incurred_on < ${w.toExcl}::date
        ${byProp(w.propertyId)}
      GROUP BY 1, 2
    `.execute(this.db);
    return r.rows;
  }

  // ── Occupancy — booked room-nights + stay count, clipped to the window ────────
  async occupancyByProperty(w: RepoWindow): Promise<
    Array<{ property_id: string | null; property_name: string | null; nights: string | number | null; stays: string | number | null }>
  > {
    const r = await sql<{ property_id: string | null; property_name: string | null; nights: string | number | null; stays: string | number | null }>`
      SELECT p.id AS property_id, p.name AS property_name,
             COALESCE(SUM(GREATEST(0, LEAST(rsv.check_out_date, ${w.toExcl}::date) - GREATEST(rsv.check_in_date, ${w.from}::date))), 0) AS nights,
             COUNT(*) AS stays
      FROM reservations rsv
      JOIN rooms rm ON rm.id = rsv.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE rsv.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT') AND rsv.deleted_at IS NULL
        AND rsv.check_in_date < ${w.toExcl}::date AND rsv.check_out_date > ${w.from}::date
        ${byProp(w.propertyId)}
      GROUP BY 1, 2
    `.execute(this.db);
    return r.rows;
  }

  // Active room counts per property — the denominator for occupancy.
  async roomCountByProperty(propertyId?: string): Promise<Array<{ property_id: string | null; rooms: string | number }>> {
    const r = await sql<{ property_id: string | null; rooms: string | number }>`
      SELECT p.id AS property_id, COUNT(rm.id) AS rooms
      FROM rooms rm
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE rm.deleted_at IS NULL
        ${byProp(propertyId)}
      GROUP BY 1
    `.execute(this.db);
    return r.rows;
  }
}
