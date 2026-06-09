import { describe, it, expect } from 'vitest';
import { todayInPropertyTZ, PROPERTY_TIMEZONE } from '../../../src/core/time.js';

describe('todayInPropertyTZ', () => {
  it('is anchored to Gaborone (UTC+2), not UTC, across midnight', () => {
    // 23:30 UTC on Jun 9 is already 01:30 Jun 10 in Gaborone — the local day has rolled over.
    expect(todayInPropertyTZ(new Date('2026-06-09T23:30:00Z'))).toBe('2026-06-10');
    // 21:30 UTC is 23:30 the same day in Gaborone — still Jun 9.
    expect(todayInPropertyTZ(new Date('2026-06-09T21:30:00Z'))).toBe('2026-06-09');
  });

  it('targets the Gaborone timezone', () => {
    expect(PROPERTY_TIMEZONE).toBe('Africa/Gaborone');
  });
});
