import type { CockpitUnit, RoomStatus } from '@/types';

// At 100+ units the flat grid is unusable, so the board needs a summary, quick
// status filters, search, and grouping. These are pure helpers so they're easy to test.

export type UnitFilter = 'ALL' | RoomStatus | 'NEEDS_CLEANING';

export interface BoardSummary {
  total: number;
  available: number;
  occupied: number;
  maintenance: number;
  outOfService: number;
  needsCleaning: number; // housekeeping_status !== READY
}

export function summarize(units: CockpitUnit[]): BoardSummary {
  const s: BoardSummary = { total: units.length, available: 0, occupied: 0, maintenance: 0, outOfService: 0, needsCleaning: 0 };
  for (const u of units) {
    if (u.status === 'AVAILABLE') s.available++;
    else if (u.status === 'OCCUPIED') s.occupied++;
    else if (u.status === 'MAINTENANCE') s.maintenance++;
    else if (u.status === 'OUT_OF_SERVICE') s.outOfService++;
    if (u.housekeeping_status !== 'READY') s.needsCleaning++;
  }
  return s;
}

export function countForFilter(s: BoardSummary, f: UnitFilter): number {
  switch (f) {
    case 'ALL': return s.total;
    case 'AVAILABLE': return s.available;
    case 'OCCUPIED': return s.occupied;
    case 'MAINTENANCE': return s.maintenance;
    case 'OUT_OF_SERVICE': return s.outOfService;
    case 'NEEDS_CLEANING': return s.needsCleaning;
  }
}

export function matchesFilter(u: CockpitUnit, filter: UnitFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'NEEDS_CLEANING') return u.housekeeping_status !== 'READY';
  return u.status === filter;
}

export function matchesQuery(u: CockpitUnit, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    u.code.toLowerCase().includes(q) ||
    u.name.toLowerCase().includes(q) ||
    (u.guest_name?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * Group label for a unit. Prefers the real building (multi-property): "J1" or
 * "J1 · Floor 2". Falls back to deriving a floor from the unit code ("304" ->
 * "Floor 3", "A101" -> "A · Floor 1"). Unmatched codes fall into "Other".
 */
export function groupLabel(unit: CockpitUnit): string {
  if (unit.building_name) {
    return unit.floor != null ? `${unit.building_name} · Floor ${unit.floor}` : unit.building_name;
  }
  const m = /^([A-Za-z]{0,2})[-\s]?(\d+)(\d{2})$/.exec(unit.code.trim());
  if (!m) return 'Other';
  const floor = `Floor ${parseInt(m[2], 10)}`;
  return m[1] ? `${m[1].toUpperCase()} · ${floor}` : floor;
}

/** Distinct {id,name} properties present in the board, for the property filter. */
export function propertiesInBoard(units: CockpitUnit[]): Array<{ id: string; name: string }> {
  const map = new Map<string, string>();
  for (const u of units) if (u.property_id && u.property_name) map.set(u.property_id, u.property_name);
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function matchesProperty(u: CockpitUnit, propertyId: string | 'ALL'): boolean {
  return propertyId === 'ALL' || u.property_id === propertyId;
}

export interface UnitGroup {
  label: string;
  units: CockpitUnit[];
}

/** Group units by building/floor label, "Other" last, units within a group sorted by code. */
export function groupUnits(units: CockpitUnit[]): UnitGroup[] {
  const map = new Map<string, CockpitUnit[]>();
  for (const u of units) {
    const label = groupLabel(u);
    const bucket = map.get(label);
    if (bucket) bucket.push(u);
    else map.set(label, [u]);
  }
  return [...map.entries()]
    .map(([label, us]) => ({
      label,
      units: us.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    }))
    .sort((a, b) => {
      if (a.label === 'Other') return 1;
      if (b.label === 'Other') return -1;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
}
