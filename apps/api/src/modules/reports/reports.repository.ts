import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import { propertyToday } from '../../core/time.js';
import { EARNING_STATUSES } from '../revenue/revenue.types.js';

export interface RepoWindow {
  from: string;     // YYYY-MM-DD inclusive
  toExcl: string;   // YYYY-MM-DD exclusive upper bound
  propertyId?: string;
  // Properties the caller may see (access scope). null = no restriction (admin);
  // [] = none (sees nothing); [...] = restrict to these.
  accessiblePropertyIds?: string[] | null;
}

interface MonthAmount { month: string; amount: string | number | null }
interface EarnedRow extends MonthAmount { tax: string | number | null; reconstructed: string | number | null }
interface PropAmount { property_id: string | null; property_name: string | null; amount: string | number | null }
interface EarnedPropRow extends PropAmount { tax: string | number | null; reconstructed: string | number | null }

// Property filters, safely parameterised: an optional "AND p.id = …" (a picked
// property) plus the access scope ("AND p.id IN (…)", or "AND FALSE" when the
// caller has no properties). admin passes null/undefined → no scope restriction.
const byProp = (id?: string, accessibleIds?: string[] | null) => {
  const idFrag = id ? sql`AND p.id = ${id}` : sql``;
  let accFrag = sql``;
  if (accessibleIds) {
    accFrag = accessibleIds.length > 0 ? sql`AND p.id IN (${sql.join(accessibleIds)})` : sql`AND FALSE`;
  }
  return sql`${idFrag} ${accFrag}`;
};

// Month labels + window filters are pinned to Africa/Gaborone — the timezone of record
// (invariant 2). `AT TIME ZONE` is applied to both the label and the comparison, so a
// row cannot be labelled with one month and filtered by another.
//
// This was UTC until 2026-09-08 (defect D08), on the reasoning that the seed's business
// dates are UTC midnights. That is true of the seed and false of the business: Gaborone
// is UTC+2, so a payment taken at 01:00 on 1 October was bucketed into September. Two
// hours of every month landed in the wrong one.
//
// WARNING this MOVES historical cash figures slightly — a handful of late-night
// payments change month — which is why D08 said to announce it rather than slide it in.
//
// The accrual ledger queries below need none of this: `stay_date` is a DATE, and a
// calendar night has no timezone to get wrong.

export class ReportsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // ── Revenue (PAID invoices, refunds negative; recognised at invoice date) ─────
  async revenueByMonth(w: RepoWindow): Promise<MonthAmount[]> {
    const r = await sql<MonthAmount>`
      SELECT to_char(i.created_at AT TIME ZONE 'Africa/Gaborone', 'YYYY-MM') AS month,
             SUM(CASE WHEN i.kind = 'REFUND' THEN -i.total_amount ELSE i.total_amount END) AS amount
      FROM invoices i
      LEFT JOIN reservations rsv ON rsv.id = i.reservation_id
      LEFT JOIN rooms rm ON rm.id = rsv.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE i.status = 'PAID' AND i.deleted_at IS NULL
        AND (i.created_at AT TIME ZONE 'Africa/Gaborone') >= ${w.from}::timestamp
        AND (i.created_at AT TIME ZONE 'Africa/Gaborone') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
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
        AND (i.created_at AT TIME ZONE 'Africa/Gaborone') >= ${w.from}::timestamp
        AND (i.created_at AT TIME ZONE 'Africa/Gaborone') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
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
        AND (i.created_at AT TIME ZONE 'Africa/Gaborone') >= ${w.from}::timestamp
        AND (i.created_at AT TIME ZONE 'Africa/Gaborone') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId, w.accessiblePropertyIds)}`.execute(this.db);
    return r.rows[0]?.vat ?? 0;
  }

  // ── Earned revenue (G30 accrual ledger, recognised per night) ────────────────
  //
  // The other basis entirely, and the reason the ledger exists: revenue is counted in
  // the month the NIGHT was slept in, not the month the money arrived. A stay running
  // 28 Sep – 3 Oct puts three nights in September and two in October however the guest
  // pays, and a pay-later guest (invariant 3) puts September's revenue in September
  // even when the cash lands in October.
  //
  // The property chain hangs off the LEDGER's own room_id, not the reservation's. A
  // booking moved to another unit changes reservations.room_id, and resolving the room
  // at read time would retrospectively move already-earned nights to the new unit —
  // putting nights on a landlord's statement for a unit that stood empty.
  //
  // `reconstructed` is the subset priced at TODAY's rates because no total was ever
  // frozen (total_source PRICED). It comes back on every row so that no caller can
  // total earned revenue without also being handed the part of it that is a guess.
  async earnedByMonth(w: RepoWindow): Promise<EarnedRow[]> {
    const r = await sql<EarnedRow>`
      SELECT to_char(rr.stay_date, 'YYYY-MM') AS month,
             SUM(rr.amount) AS amount,
             SUM(rr.tax_amount) AS tax,
             COALESCE(SUM(rr.amount) FILTER (WHERE rr.total_source = 'PRICED'), 0) AS reconstructed
      FROM revenue_recognition rr
      JOIN rooms rm ON rm.id = rr.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE rr.superseded_at IS NULL
        AND rr.stay_date >= ${w.from}::date
        AND rr.stay_date <  ${w.toExcl}::date
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
      GROUP BY 1 ORDER BY 1
    `.execute(this.db);
    return r.rows;
  }

  async earnedByProperty(w: RepoWindow): Promise<EarnedPropRow[]> {
    const r = await sql<EarnedPropRow>`
      SELECT p.id AS property_id, p.name AS property_name,
             SUM(rr.amount) AS amount,
             SUM(rr.tax_amount) AS tax,
             COALESCE(SUM(rr.amount) FILTER (WHERE rr.total_source = 'PRICED'), 0) AS reconstructed
      FROM revenue_recognition rr
      JOIN rooms rm ON rm.id = rr.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE rr.superseded_at IS NULL
        AND rr.stay_date >= ${w.from}::date
        AND rr.stay_date <  ${w.toExcl}::date
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
      GROUP BY 1, 2
    `.execute(this.db);
    return r.rows;
  }

  /**
   * Earning stays in the window that have NO live ledger rows at all.
   *
   * The difference between "September was quiet" and "September has not been
   * recognised yet". Without it an un-backfilled deployment shows a catastrophic
   * revenue drop that looks exactly like a real one, and the accrual P&L becomes a
   * number nobody can trust.
   *
   * Overlap is the same half-open test used everywhere else (invariant 4): the stay
   * touches the window if it starts before the window ends and ends after it starts.
   * EARNING_STATUSES is imported rather than repeated so this can never disagree with
   * what the recogniser actually writes.
   */
  async unrecognisedStays(w: RepoWindow): Promise<number> {
    const r = await sql<{ n: number }>`
      SELECT count(*)::int AS n
      FROM reservations r
      JOIN rooms rm ON rm.id = r.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE r.deleted_at IS NULL
        AND r.status IN (${sql.join(EARNING_STATUSES.map((st) => sql`${st}`))})
        AND r.check_in_date  < ${w.toExcl}::date
        AND r.check_out_date > ${w.from}::date
        AND NOT EXISTS (
          SELECT 1 FROM revenue_recognition rr
           WHERE rr.reservation_id = r.id AND rr.superseded_at IS NULL
        )
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
    `.execute(this.db);
    return r.rows[0]?.n ?? 0;
  }

  // ── Maintenance / contractor cost (approved spend, by opened date) ────────────
  async maintenanceByMonth(w: RepoWindow): Promise<MonthAmount[]> {
    const r = await sql<MonthAmount>`
      SELECT to_char(wo.opened_at AT TIME ZONE 'Africa/Gaborone', 'YYYY-MM') AS month, SUM(wo.cost_amount) AS amount
      FROM maintenance_work_orders wo
      LEFT JOIN rooms rm ON rm.id = wo.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE wo.cost_amount IS NOT NULL AND wo.cost_approved_at IS NOT NULL AND wo.deleted_at IS NULL
        AND (wo.opened_at AT TIME ZONE 'Africa/Gaborone') >= ${w.from}::timestamp
        AND (wo.opened_at AT TIME ZONE 'Africa/Gaborone') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
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
        AND (wo.opened_at AT TIME ZONE 'Africa/Gaborone') >= ${w.from}::timestamp
        AND (wo.opened_at AT TIME ZONE 'Africa/Gaborone') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
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
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
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
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
      GROUP BY 1, 2
    `.execute(this.db);
    return r.rows;
  }

  // ── H6 nudges — forward-looking occupancy over the next 7/30 property-days ────
  // Demand = CONFIRMED/CHECKED_IN/BLOCKED nights (unpaid PENDING is not demand);
  // capacity = active non-out-of-service rooms × days.
  async forwardOccupancy(): Promise<
    Array<{ property_id: string; property_name: string; booked_nights_7: number; booked_nights_30: number; room_count: number }>
  > {
    const res = await sql<{
      property_id: string;
      property_name: string;
      booked_nights_7: number;
      booked_nights_30: number;
      room_count: number;
    }>`
      WITH win AS (SELECT ${propertyToday()} AS s)
      SELECT
        p.id AS property_id,
        p.name AS property_name,
        coalesce(sum(GREATEST(0, LEAST(res.check_out_date, w.s + 7)  - GREATEST(res.check_in_date, w.s))), 0)::int AS booked_nights_7,
        coalesce(sum(GREATEST(0, LEAST(res.check_out_date, w.s + 30) - GREATEST(res.check_in_date, w.s))), 0)::int AS booked_nights_30,
        (SELECT count(*) FROM rooms r2
           JOIN buildings b2 ON b2.id = r2.building_id
         WHERE b2.property_id = p.id AND r2.deleted_at IS NULL AND r2.status != 'OUT_OF_SERVICE')::int AS room_count
      FROM properties p
      CROSS JOIN win w
      LEFT JOIN buildings b ON b.property_id = p.id
      LEFT JOIN rooms r ON r.building_id = b.id AND r.deleted_at IS NULL
      LEFT JOIN reservations res ON res.room_id = r.id
        AND res.deleted_at IS NULL
        AND res.status IN ('CONFIRMED', 'CHECKED_IN', 'BLOCKED')
        AND res.check_in_date < w.s + 30 AND res.check_out_date > w.s
      WHERE p.active
      GROUP BY p.id, p.name
      ORDER BY p.name
    `.execute(this.db);
    return res.rows;
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
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
      GROUP BY 1, 2
    `.execute(this.db);
    return r.rows;
  }

  // ── Occupancy by month — booked room-nights + active stays per calendar month ──
  // A reservation spanning several months contributes its overlap nights to each
  // month it touches (the month series cross-joins the bookings). Months with no
  // bookings simply don't come back — the service fills them with zeros. `stays`
  // counts a reservation once per month it is active in.
  async occupancyByMonth(w: RepoWindow): Promise<Array<{ month: string; nights: string | number | null; stays: string | number | null }>> {
    const r = await sql<{ month: string; nights: string | number | null; stays: string | number | null }>`
      WITH months AS (
        SELECT generate_series(${w.from}::date, (${w.toExcl}::date - interval '1 day'), interval '1 month')::date AS m
      )
      SELECT to_char(mo.m, 'YYYY-MM') AS month,
             SUM(GREATEST(0, LEAST(rsv.check_out_date, (mo.m + interval '1 month')::date) - GREATEST(rsv.check_in_date, mo.m))) AS nights,
             COUNT(DISTINCT rsv.id) AS stays
      FROM months mo
      JOIN reservations rsv
        ON rsv.check_in_date < (mo.m + interval '1 month')::date AND rsv.check_out_date > mo.m
      JOIN rooms rm ON rm.id = rsv.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE rsv.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT') AND rsv.deleted_at IS NULL
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
      GROUP BY 1 ORDER BY 1
    `.execute(this.db);
    return r.rows;
  }

  // Active room counts per property — the denominator for occupancy.
  async roomCountByProperty(propertyId?: string, accessibleIds?: string[] | null): Promise<Array<{ property_id: string | null; rooms: string | number }>> {
    const r = await sql<{ property_id: string | null; rooms: string | number }>`
      SELECT p.id AS property_id, COUNT(rm.id) AS rooms
      FROM rooms rm
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE rm.deleted_at IS NULL
        ${byProp(propertyId, accessibleIds)}
      GROUP BY 1
    `.execute(this.db);
    return r.rows;
  }

  // ── Owner statements — third-party-landlord units (rooms.ownership='LANDLORD') ──
  // The spine of a per-landlord payout statement: every LANDLORD-owned unit in
  // scope, carrying its owner identity (migration 054). Revenue, nights and
  // repair cost per unit come from the queries below, keyed on room id. Every
  // owned unit is listed even with no activity in the window (a zero line still
  // belongs on the owner's statement).
  async ownedUnits(propertyId?: string, accessibleIds?: string[] | null): Promise<
    Array<{ room_id: string; room_code: string | null; room_name: string; landlord_name: string | null; landlord_phone: string | null; property_id: string | null; property_name: string | null }>
  > {
    const r = await sql<{ room_id: string; room_code: string | null; room_name: string; landlord_name: string | null; landlord_phone: string | null; property_id: string | null; property_name: string | null }>`
      SELECT rm.id AS room_id, rm.code AS room_code, rm.name AS room_name,
             rm.landlord_name, rm.landlord_phone,
             p.id AS property_id, p.name AS property_name
      FROM rooms rm
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE rm.ownership = 'LANDLORD' AND rm.deleted_at IS NULL
        ${byProp(propertyId, accessibleIds)}
      ORDER BY rm.landlord_name, rm.code
    `.execute(this.db);
    return r.rows;
  }

  // Revenue per owned unit (PAID invoices, refunds negative; recognised at invoice date).
  async revenueByOwnedRoom(w: RepoWindow): Promise<Array<{ room_id: string; amount: string | number | null }>> {
    const r = await sql<{ room_id: string; amount: string | number | null }>`
      SELECT rsv.room_id AS room_id,
             SUM(CASE WHEN i.kind = 'REFUND' THEN -i.total_amount ELSE i.total_amount END) AS amount
      FROM invoices i
      JOIN reservations rsv ON rsv.id = i.reservation_id
      JOIN rooms rm ON rm.id = rsv.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE i.status = 'PAID' AND i.deleted_at IS NULL
        AND rm.ownership = 'LANDLORD' AND rm.deleted_at IS NULL
        AND (i.created_at AT TIME ZONE 'Africa/Gaborone') >= ${w.from}::timestamp
        AND (i.created_at AT TIME ZONE 'Africa/Gaborone') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
      GROUP BY 1
    `.execute(this.db);
    return r.rows;
  }

  // Booked room-nights per owned unit, clipped to the window.
  async occupancyByOwnedRoom(w: RepoWindow): Promise<Array<{ room_id: string; nights: string | number | null }>> {
    const r = await sql<{ room_id: string; nights: string | number | null }>`
      SELECT rsv.room_id AS room_id,
             COALESCE(SUM(GREATEST(0, LEAST(rsv.check_out_date, ${w.toExcl}::date) - GREATEST(rsv.check_in_date, ${w.from}::date))), 0) AS nights
      FROM reservations rsv
      JOIN rooms rm ON rm.id = rsv.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE rsv.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT') AND rsv.deleted_at IS NULL
        AND rm.ownership = 'LANDLORD' AND rm.deleted_at IS NULL
        AND rsv.check_in_date < ${w.toExcl}::date AND rsv.check_out_date > ${w.from}::date
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
      GROUP BY 1
    `.execute(this.db);
    return r.rows;
  }

  // Approved repair/maintenance cost charged to each owned unit (by opened date).
  async maintenanceByOwnedRoom(w: RepoWindow): Promise<Array<{ room_id: string; amount: string | number | null }>> {
    const r = await sql<{ room_id: string; amount: string | number | null }>`
      SELECT wo.room_id AS room_id, SUM(wo.cost_amount) AS amount
      FROM maintenance_work_orders wo
      JOIN rooms rm ON rm.id = wo.room_id
      LEFT JOIN buildings b ON b.id = rm.building_id
      LEFT JOIN properties p ON p.id = b.property_id
      WHERE wo.cost_amount IS NOT NULL AND wo.cost_approved_at IS NOT NULL AND wo.deleted_at IS NULL
        AND rm.ownership = 'LANDLORD' AND rm.deleted_at IS NULL
        AND (wo.opened_at AT TIME ZONE 'Africa/Gaborone') >= ${w.from}::timestamp
        AND (wo.opened_at AT TIME ZONE 'Africa/Gaborone') <  ${w.toExcl}::timestamp
        ${byProp(w.propertyId, w.accessiblePropertyIds)}
      GROUP BY 1
    `.execute(this.db);
    return r.rows;
  }
}
