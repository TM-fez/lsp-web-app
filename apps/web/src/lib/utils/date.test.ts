import { describe, it, expect, afterEach, vi } from 'vitest';
import { todayISO, calendarDay, shortDay } from './date';

afterEach(() => vi.useRealTimers());

describe('todayISO', () => {
  it('returns the property-timezone day, not the browser/UTC day, near midnight', () => {
    vi.useFakeTimers();
    // 23:30 UTC -> 01:30 the next day in Gaborone (UTC+2).
    vi.setSystemTime(new Date('2026-06-09T23:30:00Z'));
    expect(todayISO()).toBe('2026-06-10');
  });

  it('applies whole-day offsets without drifting across midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T23:30:00Z'));
    expect(todayISO(1)).toBe('2026-06-11');
    expect(todayISO(-1)).toBe('2026-06-09');
  });
});

describe('calendarDay / shortDay', () => {
  it('strips an ISO timestamp down to the stored calendar day', () => {
    expect(calendarDay('2026-08-21T00:00:00.000Z')).toBe('2026-08-21');
    expect(calendarDay('2026-08-21')).toBe('2026-08-21');
  });

  it('prints MM-DD without leaking the timestamp tail', () => {
    expect(shortDay('2026-08-21T00:00:00.000Z')).toBe('08-21');
    expect(shortDay('2026-08-21')).toBe('08-21');
  });
});
