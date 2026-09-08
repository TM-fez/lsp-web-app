import { buildNudges, type Nudge } from './reports.nudges.js';
import { ReportsRepository, type RepoWindow } from './reports.repository.js';
import type {
  ReportWindow, ReportsResponse, MonthlyPoint, PropertyPnl,
  RevenueBasis, AccrualDisclosure, RevenueReconciliation, EarnedReceivedPoint,
  OperationsWindow, OperationsResponse, OpsKpis, OpsDeltas, OpsMonthlyPoint, OpsPropertyRow,
  OwnerStatementWindow, OwnersResponse, OwnerStatement, OwnerUnitLine,
} from './reports.types.js';

const DAY = 86_400_000;
const num = (v: string | number | null | undefined) => Number(v ?? 0);
const round1 = (x: number) => Math.round(x * 10) / 10;
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const COMPANY_WIDE = 'Company-wide';
const UNNAMED_LANDLORD = 'Unnamed landlord';

function parseISO(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/** Resolve the request window: explicit from/to, else the trailing 12 months. */
function normalize(req: ReportWindow): RepoWindow & { from: string; to: string; basis: RevenueBasis } {
  const now = new Date();
  const defFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const defToExcl = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const from = req.from ?? defFrom.toISOString().slice(0, 10);
  const to = req.to ?? new Date(defToExcl.getTime() - DAY).toISOString().slice(0, 10);
  // exclusive upper bound = day after `to`
  const toExcl = new Date(parseISO(to).getTime() + DAY).toISOString().slice(0, 10);

  return {
    from,
    to,
    toExcl,
    propertyId: req.propertyId,
    accessiblePropertyIds: req.accessiblePropertyIds,
    // Accrual unless the caller explicitly asks for cash. Owner decision 2026-09-07:
    // LSP is the book of record for revenue, so "what did we earn" is the default
    // question and "what did we collect" is the one you opt into.
    basis: req.basis ?? 'ACCRUAL',
  };
}

/** Reconstructed share of a revenue figure, rounded for display. */
function disclose(revenue: number, reconstructed: number, unrecognisedStays: number): AccrualDisclosure {
  return {
    reconstructed,
    reconstructed_pct: revenue > 0 ? round1((reconstructed / revenue) * 100) : 0,
    unrecognised_stays: unrecognisedStays,
  };
}

function monthsBetween(from: string, toExcl: string): string[] {
  const out: string[] = [];
  const start = parseISO(from);
  const end = parseISO(toExcl);
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur < end) {
    out.push(monthKey(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: string, toExcl: string) =>
  Math.max(1, Math.round((parseISO(toExcl).getTime() - parseISO(from).getTime()) / DAY));

/** Trailing N *completed* months: [first-of-(N-months-ago), first-of-this-month). */
function operationsWindow(monthsRaw: number): { from: string; toExcl: string; months: number } {
  const months = Math.min(24, Math.max(1, Math.round(monthsRaw || 12)));
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const toExcl = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: iso(from), toExcl: iso(toExcl), months };
}

/** The same span one year earlier (the annual comparative). */
function shiftBackYear(w: { from: string; toExcl: string }): { from: string; toExcl: string } {
  const back = (s: string) => {
    const d = parseISO(s);
    return iso(new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate())));
  };
  return { from: back(w.from), toExcl: back(w.toExcl) };
}

/** Calendar days in a 'YYYY-MM' month. */
function daysInMonthOf(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // day 0 of next month = last of this
}

const pctChange = (prev: number, cur: number): number | null =>
  prev > 0 ? round1(((cur - prev) / prev) * 100) : null;

/** Occupancy / ADR / RevPAR for one window, from its per-property occupancy + revenue rows. */
function buildKpis(
  occProp: Array<{ nights: string | number | null; stays: string | number | null }>,
  revMonth: Array<{ amount: string | number | null }>,
  totalRooms: number,
  days: number,
): OpsKpis {
  const nights = occProp.reduce((s, r) => s + num(r.nights), 0);
  const reservations = occProp.reduce((s, r) => s + num(r.stays), 0);
  const revenue = revMonth.reduce((s, r) => s + num(r.amount), 0);
  const available = totalRooms * days;
  return {
    occupancy_pct: available > 0 ? round1((nights / available) * 100) : 0,
    room_nights_booked: nights,
    room_nights_available: available,
    reservations,
    revenue,
    adr: nights > 0 ? Math.round(revenue / nights) : 0,
    revpar: available > 0 ? Math.round(revenue / available) : 0,
  };
}

export class ReportsService {
  constructor(private readonly repo: ReportsRepository) {}

  /** H6 — occupancy nudges, filtered to the caller's accessible properties. */
  async getNudges(accessiblePropertyIds: string[] | null): Promise<Nudge[]> {
    let rows = await this.repo.forwardOccupancy();
    if (accessiblePropertyIds !== null) {
      const allowed = new Set(accessiblePropertyIds);
      rows = rows.filter((r) => allowed.has(r.property_id));
    }
    return buildNudges(rows);
  }

  /**
   * Earned vs received, month by month — the reconciliation the accrual switch makes
   * necessary.
   *
   * The gap between the two columns is the point, not an error to chase. A guest who
   * stays in September and settles in October earns in the September row and pays in
   * the October one; the running difference is what the house is owed for nights it
   * has already provided. Before the ledger this question could not be asked at all,
   * because both numbers were the same number.
   *
   * Months come from the window, not from the data, so a month that earned nothing and
   * collected nothing still appears as a zero row. A missing month reads as an outage;
   * an explicit zero reads as a quiet month, which is what it is.
   */
  async getRevenue(reqWindow: ReportWindow): Promise<RevenueReconciliation> {
    const w = normalize(reqWindow);

    const [earnedMonth, cashMonth, unrecognised] = await Promise.all([
      this.repo.earnedByMonth(w),
      this.repo.revenueByMonth(w),
      this.repo.unrecognisedStays(w),
    ]);

    const earnedByM = new Map(earnedMonth.map((r) => [r.month, r]));
    const cashByM = new Map(cashMonth.map((r) => [r.month, num(r.amount)]));

    const monthly: EarnedReceivedPoint[] = monthsBetween(w.from, w.toExcl).map((month) => {
      const earned = num(earnedByM.get(month)?.amount);
      const received = cashByM.get(month) ?? 0;
      return {
        month,
        earned,
        received,
        difference: earned - received,
        reconstructed: num(earnedByM.get(month)?.reconstructed),
      };
    });

    const earned = monthly.reduce((sum, m) => sum + m.earned, 0);
    const received = monthly.reduce((sum, m) => sum + m.received, 0);
    const reconstructed = monthly.reduce((sum, m) => sum + m.reconstructed, 0);

    return {
      from: w.from,
      to: w.to,
      monthly,
      totals: {
        earned,
        received,
        difference: earned - received,
        earned_tax: earnedMonth.reduce((sum, row) => sum + num(row.tax), 0),
      },
      disclosure: disclose(earned, reconstructed, unrecognised),
    };
  }

  async getReports(reqWindow: ReportWindow): Promise<ReportsResponse> {
    const w = normalize(reqWindow);

    const accrual = w.basis === 'ACCRUAL';

    const [
      cashMonth, earnedMonth, maintMonth, opexMonth,
      cashProp, earnedProp, maintProp, opexProp,
      occProp, roomCounts, vatTotal, unrecognised,
    ] = await Promise.all([
      this.repo.revenueByMonth(w),
      this.repo.earnedByMonth(w),
      this.repo.maintenanceByMonth(w),
      this.repo.opexByMonth(w),
      this.repo.revenueByProperty(w),
      this.repo.earnedByProperty(w),
      this.repo.maintenanceByProperty(w),
      this.repo.opexByProperty(w),
      this.repo.occupancyByProperty(w),
      this.repo.roomCountByProperty(w.propertyId, w.accessiblePropertyIds),
      this.repo.vatOutput(w),
      accrual ? this.repo.unrecognisedStays(w) : Promise.resolve(0),
    ]);

    // Both bases are fetched either way — they are two cheap aggregates, and the
    // disclosure needs the accrual side even to say how much of it is reconstructed.
    // Which one becomes `revenue` is the only thing `basis` decides.
    const revMonth = accrual ? earnedMonth : cashMonth;
    const revProp = accrual ? earnedProp : cashProp;

    // ── Monthly series ──────────────────────────────────────────────────────────
    // month is already a UTC 'YYYY-MM' string from SQL.
    const revByM = new Map(revMonth.map((r) => [r.month, num(r.amount)]));
    const maintByM = new Map(maintMonth.map((r) => [r.month, num(r.amount)]));
    const opexByM = new Map(opexMonth.map((r) => [r.month, num(r.amount)]));

    const monthly: MonthlyPoint[] = monthsBetween(w.from, w.toExcl).map((month) => {
      const revenue = revByM.get(month) ?? 0;
      const maintenance_cost = maintByM.get(month) ?? 0;
      const operating_expenses = opexByM.get(month) ?? 0;
      return { month, revenue, maintenance_cost, operating_expenses, net: revenue - maintenance_cost - operating_expenses };
    });

    // ── Per-property breakdown ──────────────────────────────────────────────────
    const days = Math.max(1, Math.round((parseISO(w.toExcl).getTime() - parseISO(w.from).getTime()) / DAY));
    const roomsByP = new Map(roomCounts.map((r) => [r.property_id, num(r.rooms)]));
    const occByP = new Map(occProp.map((r) => [r.property_id, { nights: num(r.nights), stays: num(r.stays) }]));

    const propIds = new Set<string | null>();
    const names = new Map<string | null, string>();
    const addRows = (rows: Array<{ property_id: string | null; property_name: string | null }>) =>
      rows.forEach((r) => {
        propIds.add(r.property_id);
        if (!names.has(r.property_id)) names.set(r.property_id, r.property_name ?? COMPANY_WIDE);
      });
    addRows(revProp); addRows(maintProp); addRows(opexProp); addRows(occProp);

    const sumByP = (rows: Array<{ property_id: string | null; amount: string | number | null }>) =>
      new Map(rows.map((r) => [r.property_id, num(r.amount)]));
    const revP = sumByP(revProp), maintP = sumByP(maintProp), opexP = sumByP(opexProp);


    const by_property: PropertyPnl[] = [...propIds].map((pid) => {
      const revenue = revP.get(pid) ?? 0;
      const maintenance_cost = maintP.get(pid) ?? 0;
      const operating_expenses = opexP.get(pid) ?? 0;
      const rooms = roomsByP.get(pid) ?? 0;
      const nights = occByP.get(pid)?.nights ?? 0;
      const occupancy_pct = rooms > 0 ? round1((nights / (rooms * days)) * 100) : null;
      return {
        property_id: pid,
        property_name: names.get(pid) ?? COMPANY_WIDE,
        revenue,
        maintenance_cost,
        operating_expenses,
        net: revenue - maintenance_cost - operating_expenses,
        occupancy_pct,
      };
    }).sort((a, b) => b.revenue - a.revenue);

    // ── Summary totals ──────────────────────────────────────────────────────────
    const revenue = monthly.reduce((s, m) => s + m.revenue, 0);
    const maintenance_cost = monthly.reduce((s, m) => s + m.maintenance_cost, 0);
    const operating_expenses = monthly.reduce((s, m) => s + m.operating_expenses, 0);
    const total_cost = maintenance_cost + operating_expenses;
    const net = revenue - total_cost;

    const totalRooms = [...roomsByP.values()].reduce((s, n) => s + n, 0);
    const room_nights_booked = occProp.reduce((s, r) => s + num(r.nights), 0);
    const room_nights_available = totalRooms * days;
    const reservations = occProp.reduce((s, r) => s + num(r.stays), 0);

    return {
      summary: {
        from: w.from,
        to: w.to,
        revenue_basis: w.basis,
        revenue,
        // Only on the accrual side: there is nothing reconstructed about cash, and
        // nothing missing from it that a backfill would supply.
        ...(accrual
          ? {
              disclosure: disclose(
                revenue,
                earnedMonth.reduce((sum, row) => sum + num(row.reconstructed), 0),
                unrecognised
              ),
            }
          : {}),
        maintenance_cost,
        operating_expenses,
        total_cost,
        net,
        margin_pct: revenue > 0 ? round1((net / revenue) * 100) : 0,
        vat_output: num(vatTotal),
        reservations,
        room_nights_booked,
        room_nights_available,
        occupancy_pct: room_nights_available > 0 ? round1((room_nights_booked / room_nights_available) * 100) : 0,
      },
      monthly,
      by_property,
    };
  }

  /** P4.3 — Operational Cockpit: occupancy trend + year-over-year comparison. */
  async getOperations(req: OperationsWindow): Promise<OperationsResponse> {
    const cur = operationsWindow(req.months ?? 12);
    const prev = shiftBackYear(cur);
    const scope = { propertyId: req.propertyId, accessiblePropertyIds: req.accessiblePropertyIds };
    const curW: RepoWindow = { from: cur.from, toExcl: cur.toExcl, ...scope };
    const prevW: RepoWindow = { from: prev.from, toExcl: prev.toExcl, ...scope };

    const [occMonth, revMonthCur, occPropCur, roomCounts, revMonthPrev, occPropPrev] = await Promise.all([
      this.repo.occupancyByMonth(curW),
      this.repo.revenueByMonth(curW),
      this.repo.occupancyByProperty(curW),
      this.repo.roomCountByProperty(req.propertyId, req.accessiblePropertyIds),
      this.repo.revenueByMonth(prevW),
      this.repo.occupancyByProperty(prevW),
    ]);

    // Current estate applied across both windows — the same simplification the P&L makes.
    const totalRooms = roomCounts.reduce((s, r) => s + num(r.rooms), 0);
    const curDays = daysBetween(cur.from, cur.toExcl);
    const prevDays = daysBetween(prev.from, prev.toExcl);

    const summary = buildKpis(occPropCur, revMonthCur, totalRooms, curDays);
    const previous = {
      ...buildKpis(occPropPrev, revMonthPrev, totalRooms, prevDays),
      from: prev.from,
      to: iso(new Date(parseISO(prev.toExcl).getTime() - DAY)),
    };

    const deltas: OpsDeltas = {
      occupancy_pts: round1(summary.occupancy_pct - previous.occupancy_pct),
      reservations_pct: pctChange(previous.reservations, summary.reservations),
      adr_pct: pctChange(previous.adr, summary.adr),
      revpar_pct: pctChange(previous.revpar, summary.revpar),
      revenue_pct: pctChange(previous.revenue, summary.revenue),
    };

    // ── Monthly trend — every month in the window, zero-filled ────────────────────
    const revByM = new Map(revMonthCur.map((r) => [r.month, num(r.amount)]));
    const occByM = new Map(occMonth.map((r) => [r.month, r]));
    const monthly: OpsMonthlyPoint[] = monthsBetween(cur.from, cur.toExcl).map((month) => {
      const o = occByM.get(month);
      const nights = num(o?.nights);
      const available = totalRooms * daysInMonthOf(month);
      const revenue = revByM.get(month) ?? 0;
      return {
        month,
        occupancy_pct: available > 0 ? round1((nights / available) * 100) : 0,
        room_nights_booked: nights,
        room_nights_available: available,
        reservations: num(o?.stays),
        revenue,
        adr: nights > 0 ? Math.round(revenue / nights) : 0,
      };
    });

    // ── Per-property occupancy over the window (best first) ───────────────────────
    const roomsByP = new Map(roomCounts.map((r) => [r.property_id, num(r.rooms)]));
    const by_property: OpsPropertyRow[] = occPropCur.map((r) => {
      const rooms = roomsByP.get(r.property_id) ?? 0;
      const nights = num(r.nights);
      return {
        property_id: r.property_id,
        property_name: r.property_name ?? COMPANY_WIDE,
        occupancy_pct: rooms > 0 ? round1((nights / (rooms * curDays)) * 100) : null,
        room_nights_booked: nights,
        reservations: num(r.stays),
      };
    }).sort((a, b) => (b.occupancy_pct ?? -1) - (a.occupancy_pct ?? -1));

    return {
      window: { from: cur.from, to: iso(new Date(parseISO(cur.toExcl).getTime() - DAY)), months: cur.months },
      summary,
      previous,
      deltas,
      monthly,
      by_property,
    };
  }

  /**
   * Owner statements — a per-landlord payout for the window. Walks the same
   * invoice→reservation→room and work-order→room joins as the P&L, but scoped to
   * LANDLORD-owned units and keyed on the unit, then rolls units up by their
   * free-text landlord_name. Net is revenue less the repair cost charged to that
   * owner — i.e. what LSP owes the landlord.
   */
  async getOwnerStatements(req: OwnerStatementWindow): Promise<OwnersResponse> {
    const w = normalize(req);

    const [units, rev, occ, maint] = await Promise.all([
      this.repo.ownedUnits(w.propertyId, w.accessiblePropertyIds),
      this.repo.revenueByOwnedRoom(w),
      this.repo.occupancyByOwnedRoom(w),
      this.repo.maintenanceByOwnedRoom(w),
    ]);

    const days = daysBetween(w.from, w.toExcl);
    const revByRoom = new Map(rev.map((r) => [r.room_id, num(r.amount)]));
    const occByRoom = new Map(occ.map((r) => [r.room_id, num(r.nights)]));
    const maintByRoom = new Map(maint.map((r) => [r.room_id, num(r.amount)]));

    // Group owned units by landlord (unnamed units share one fallback bucket).
    const groups = new Map<string, { phone: string | null; units: OwnerUnitLine[] }>();
    for (const u of units) {
      const key = u.landlord_name?.trim() || UNNAMED_LANDLORD;
      const revenue = revByRoom.get(u.room_id) ?? 0;
      const nights = occByRoom.get(u.room_id) ?? 0;
      const maintenance_cost = maintByRoom.get(u.room_id) ?? 0;
      const line: OwnerUnitLine = {
        room_id: u.room_id,
        room_code: u.room_code,
        room_name: u.room_name,
        property_id: u.property_id,
        property_name: u.property_name ?? COMPANY_WIDE,
        revenue,
        nights,
        occupancy_pct: days > 0 ? round1((nights / days) * 100) : 0,
        maintenance_cost,
        net: revenue - maintenance_cost,
      };
      const g = groups.get(key) ?? { phone: null, units: [] };
      if (!g.phone && u.landlord_phone) g.phone = u.landlord_phone;
      g.units.push(line);
      groups.set(key, g);
    }

    const owners: OwnerStatement[] = [...groups.entries()].map(([landlord_name, g]) => {
      const revenue = g.units.reduce((s, u) => s + u.revenue, 0);
      const nights = g.units.reduce((s, u) => s + u.nights, 0);
      const maintenance_cost = g.units.reduce((s, u) => s + u.maintenance_cost, 0);
      const room_nights_available = g.units.length * days;
      return {
        landlord_name,
        landlord_phone: g.phone,
        unit_count: g.units.length,
        revenue,
        nights,
        room_nights_available,
        occupancy_pct: room_nights_available > 0 ? round1((nights / room_nights_available) * 100) : 0,
        maintenance_cost,
        net: revenue - maintenance_cost,
        units: g.units,
      };
    }).sort((a, b) => b.net - a.net);

    return {
      from: w.from,
      to: w.to,
      owners,
      totals: {
        landlords: owners.length,
        units: owners.reduce((s, o) => s + o.unit_count, 0),
        revenue: owners.reduce((s, o) => s + o.revenue, 0),
        maintenance_cost: owners.reduce((s, o) => s + o.maintenance_cost, 0),
        net: owners.reduce((s, o) => s + o.net, 0),
      },
    };
  }
}
