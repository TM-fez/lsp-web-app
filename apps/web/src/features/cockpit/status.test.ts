import { describe, it, expect } from 'vitest';
import { formatMoney, isAssignable, housekeepingTone, reservationTone } from './status';

describe('cockpit status helpers', () => {
  it('formats integer thebe as BWP major units', () => {
    expect(formatMoney(114000)).toBe('BWP 1140.00');
    expect(formatMoney(57000, 'BWP')).toBe('BWP 570.00');
  });

  it('only treats AVAILABLE + READY units as assignable', () => {
    expect(isAssignable('AVAILABLE', 'READY')).toBe(true);
    expect(isAssignable('AVAILABLE', 'DIRTY')).toBe(false);
    expect(isAssignable('OCCUPIED', 'READY')).toBe(false);
    expect(isAssignable('MAINTENANCE', 'READY')).toBe(false);
  });

  it('maps statuses to badge tones', () => {
    expect(housekeepingTone.READY).toBe('green');
    expect(housekeepingTone.DIRTY).toBe('rose');
    expect(reservationTone.CONFIRMED).toBe('green');
    expect(reservationTone.PENDING).toBe('amber');
  });
});
