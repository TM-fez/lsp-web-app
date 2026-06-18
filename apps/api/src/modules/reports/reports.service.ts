import { ReportsRepository, type RepoWindow } from './reports.repository.js';
import type { ReportWindow, ReportsResponse, MonthlyPoint, PropertyPnl } from './reports.types.js';

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

  return { from, to, toExcl, propertyId: req.propertyId };
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

export class ReportsService {
  constructor(private readonly repo: ReportsRepository) {}

  async getReports(reqWindow: ReportWindow): Promise<ReportsResponse> {
    const w = normalize(reqWindow);

    const [
      revMonth, maintMonth, opexMonth,
      revProp, maintProp, opexProp,
      occProp, roomCounts,
    ] = await Promise.all([
      this.repo.revenueByMonth(w),
      this.repo.maintenanceByMonth(w),
      this.repo.opexByMonth(w),
      this.repo.revenueByProperty(w),
      this.repo.maintenanceByProperty(w),
      this.repo.opexByProperty(w),
      this.repo.occupancyByProperty(w),
      this.repo.roomCountByProperty(w.propertyId),
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
        reservations,
        room_nights_booked,
        room_nights_available,
        occupancy_pct: room_nights_available > 0 ? round1((room_nights_booked / room_nights_available) * 100) : 0,
      },
      monthly,
      by_property,
    };
  }
}
