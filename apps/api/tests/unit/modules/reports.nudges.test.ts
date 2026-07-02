import { describe, it, expect } from 'vitest';
import { buildNudges, type ForwardOccupancyRow } from '../../../src/modules/reports/reports.nudges.js';

const row = (over: Partial<ForwardOccupancyRow> = {}): ForwardOccupancyRow => ({
  property_id: 'p1',
  property_name: 'Village',
  booked_nights_7: 0,
  booked_nights_30: 0,
  room_count: 10,
  ...over,
});

describe('buildNudges', () => {
  it('flags a hot week as an opportunity (>= 85% of the next 7 days booked)', () => {
    const nudges = buildNudges([row({ booked_nights_7: 60 })]); // 60/70 ≈ 86%
    expect(nudges.some((n) => n.tone === 'opportunity' && n.title.includes('High demand'))).toBe(true);
  });

  it('flags a quiet week as info (<= 35%)', () => {
    const nudges = buildNudges([row({ booked_nights_7: 14, booked_nights_30: 150 })]); // 20% week, 50% month
    expect(nudges).toHaveLength(1);
    expect(nudges[0]!.tone).toBe('info');
    expect(nudges[0]!.detail).toContain('20%');
  });

  it('stays silent in the healthy middle band', () => {
    // 60% week, 55% month — nothing to say.
    expect(buildNudges([row({ booked_nights_7: 42, booked_nights_30: 165 })])).toHaveLength(0);
  });

  it('can raise both a week and a month nudge for the same property', () => {
    const nudges = buildNudges([row({ booked_nights_7: 63, booked_nights_30: 250 })]); // 90% / 83%
    expect(nudges).toHaveLength(2);
    expect(nudges.every((n) => n.tone === 'opportunity')).toBe(true);
  });

  it('skips properties with no rooms (no division by zero)', () => {
    expect(buildNudges([row({ room_count: 0, booked_nights_7: 5 })])).toHaveLength(0);
  });
});
