import { describe, it, expect } from 'vitest';
import { nights, statusTone, statusLabel, isOpen } from './util';

describe('nights', () => {
  it('counts whole nights, check-out exclusive', () => {
    expect(nights('2026-07-01', '2026-07-04')).toBe(3);
    expect(nights('2026-07-01', '2026-07-02')).toBe(1);
  });

  it('handles full ISO timestamps too', () => {
    expect(nights('2026-07-01T00:00:00.000Z', '2026-07-03T00:00:00.000Z')).toBe(2);
  });

  it('never returns negative and tolerates bad input', () => {
    expect(nights('2026-07-04', '2026-07-01')).toBe(0);
    expect(nights('nope', 'also-nope')).toBe(0);
  });
});

describe('status helpers', () => {
  it('has a tone for every status', () => {
    (['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'] as const).forEach((s) => {
      expect(statusTone[s]).toBeTruthy();
    });
  });

  it('labels are human-readable', () => {
    expect(statusLabel('CHECKED_IN')).toBe('checked in');
  });

  it('only PENDING/CONFIRMED are open for edit/cancel', () => {
    expect(isOpen('PENDING')).toBe(true);
    expect(isOpen('CONFIRMED')).toBe(true);
    expect(isOpen('CHECKED_IN')).toBe(false);
    expect(isOpen('CHECKED_OUT')).toBe(false);
    expect(isOpen('CANCELLED')).toBe(false);
  });
});
