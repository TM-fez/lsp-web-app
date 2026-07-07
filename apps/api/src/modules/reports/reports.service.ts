import { buildNudges, type Nudge } from './reports.nudges.js';
import { ReportsRepository, type RepoWindow } from './reports.repository.js';
import type {
  ReportWindow, ReportsResponse, MonthlyPoint, PropertyPnl,
  OperationsWindow, OperationsResponse, OpsKpis, OpsDeltas, OpsMonthlyPoint, OpsPropertyRow,
} from './reports.types.js';

const DAY = 86_400_000;
const num = (v: string | number | null | undefined) => Number(v ?? 0);
const round1 = (x: number) => Math.round(x * 10) / 10;
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const COMPANY_WIDE = 'Company-wide';

function parseISO(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/** Resolve the request window: explicit from/to, else the trailing 12 months. */
function normalize(req: ReportWindow): RepoWindow & { from: string; to: string } {
  const now = new Date();
  const defFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const defToExcl = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const from = req.from ?? defFrom.toISOString().slice(0, 10);
  const to = req.to ?? new Date(defToExcl.getTime() - DAY).toISOString().slice(0, 10);
  // exclusive upper bound = day after `to`
  const toExcl = new Date(parseISO(to).getTime() + DAY).toISOString().slice(0, 10);

  return { from, to, toExcl, propertyId: req.propertyId, accessiblePropertyIds: req.accessiblePropertyIds };
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

  async getReports(reqWindow: ReportWindow): Promise<ReportsResponse> {
    const w = normalize(reqWindow);

    const [
      revMonth, maintMonth, opexMonth,
      revProp, maintProp, opexProp,
      occProp, roomCounts, vatTotal,
    ] = await Promise.all([
      this.repo.revenueByMonth(w),
      this.repo.maintenanceByMonth(w),
      this.repo.opexByMonth(w),
      this.repo.revenueByProperty(w),
      this.repo.maintenanceByProperty(w),
      this.repo.opexByProperty(w),
      this.repo.occupancyByProperty(w),
      this.repo.roomCountByProperty(w.propertyId, w.accessiblePropertyIds),
      this.repo.vatOutput(w),
    ]);

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
        revenue,
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
}
