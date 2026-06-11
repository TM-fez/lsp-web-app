import { describe, it, expect } from 'vitest';
import { summarize, countForFilter, matchesFilter, matchesQuery, groupLabel, groupUnits } from './board';
import type { CockpitUnit } from '@/types';

function unit(partial: Partial<CockpitUnit> & { code: string }): CockpitUnit {
  return {
    room_id: partial.code,
    name: `Unit ${partial.code}`,
    code: partial.code,
    type: 'STANDARD',
    status: 'AVAILABLE',
    housekeeping_status: 'READY',
    capacity: 2,
    guest_name: null,
    occupancy_id: null,
    reservation_id: null,
    check_out_date: null,
    ...partial,
  };
}

const units: CockpitUnit[] = [
  unit({ code: '101', status: 'OCCUPIED', housekeeping_status: 'READY', guest_name: 'Thabo Moeng' }),
  unit({ code: '102', status: 'AVAILABLE', housekeeping_status: 'DIRTY' }),
  unit({ code: '203', status: 'MAINTENANCE', housekeeping_status: 'READY' }),
  unit({ code: '204', status: 'OUT_OF_SERVICE', housekeeping_status: 'READY' }),
  unit({ code: 'E2E-9', status: 'AVAILABLE', housekeeping_status: 'READY' }),
];

describe('summarize / countForFilter', () => {
  it('tallies each status and "needs cleaning" (housekeeping != READY)', () => {
    const s = summarize(units);
    expect(s).toMatchObject({ total: 5, available: 2, occupied: 1, maintenance: 1, outOfService: 1, needsCleaning: 1 });
    expect(countForFilter(s, 'AVAILABLE')).toBe(2);
    expect(countForFilter(s, 'NEEDS_CLEANING')).toBe(1);
  });
});

describe('matchesFilter', () => {
  it('filters by room status and the needs-cleaning shortcut', () => {
    expect(units.filter((u) => matchesFilter(u, 'MAINTENANCE')).map((u) => u.code)).toEqual(['203']);
    expect(units.filter((u) => matchesFilter(u, 'NEEDS_CLEANING')).map((u) => u.code)).toEqual(['102']);
    expect(units.filter((u) => matchesFilter(u, 'ALL'))).toHaveLength(5);
  });
});

describe('matchesQuery', () => {
  it('matches code, name, or guest (case-insensitive); blank matches all', () => {
    expect(matchesQuery(units[0], 'thabo')).toBe(true);
    expect(matchesQuery(units[0], '101')).toBe(true);
    expect(matchesQuery(units[1], 'thabo')).toBe(false);
    expect(matchesQuery(units[1], '')).toBe(true);
  });
});

describe('groupLabel', () => {
  it('derives a floor (and optional building) from the code, else "Other"', () => {
    expect(groupLabel('304')).toBe('Floor 3');
    expect(groupLabel('1015')).toBe('Floor 10');
    expect(groupLabel('A101')).toBe('A · Floor 1');
    expect(groupLabel('E2E-9')).toBe('Other');
  });
});

describe('groupUnits', () => {
  it('groups by floor, sorts groups naturally with "Other" last, units by code', () => {
    const groups = groupUnits(units);
    expect(groups.map((g) => g.label)).toEqual(['Floor 1', 'Floor 2', 'Other']);
    expect(groups[0].units.map((u) => u.code)).toEqual(['101', '102']);
  });
});
