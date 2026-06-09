import { describe, it, expect, afterEach, vi } from 'vitest';
import { todayISO } from './date';

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
