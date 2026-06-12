import { describe, it, expect } from 'vitest';
import { summarize, countForFilter, matchesFilter, matchesQuery, groupLabel, groupUnits, propertiesInBoard, matchesProperty } from './board';
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
    expect(groupLabel(unit({ code: '304' }))).toBe('Floor 3');
    expect(groupLabel(unit({ code: '1015' }))).toBe('Floor 10');
    expect(groupLabel(unit({ code: 'A101' }))).toBe('A · Floor 1');
    expect(groupLabel(unit({ code: 'E2E-9' }))).toBe('Other');
  });

  it('prefers the real building (+floor) when present', () => {
    expect(groupLabel(unit({ code: '101', building_name: 'J1' }))).toBe('J1');
    expect(groupLabel(unit({ code: '101', building_name: 'J1', floor: 2 }))).toBe('J1 · Floor 2');
  });
});

describe('propertiesInBoard / matchesProperty', () => {
  it('lists distinct properties and filters units by property', () => {
    const us = [
      unit({ code: '1', property_id: 'v', property_name: 'Village' }),
      unit({ code: '2', property_id: 'c', property_name: 'CBD' }),
      unit({ code: '3', property_id: 'v', property_name: 'Village' }),
    ];
    expect(propertiesInBoard(us).map((p) => p.name)).toEqual(['CBD', 'Village']);
    expect(us.filter((u) => matchesProperty(u, 'v')).map((u) => u.code)).toEqual(['1', '3']);
    expect(us.filter((u) => matchesProperty(u, 'ALL'))).toHaveLength(3);
  });
});

describe('groupUnits', () => {
  it('groups by floor, sorts groups naturally with "Other" last, units by code', () => {
    const groups = groupUnits(units);
    expect(groups.map((g) => g.label)).toEqual(['Floor 1', 'Floor 2', 'Other']);
    expect(groups[0].units.map((u) => u.code)).toEqual(['101', '102']);
  });
});
