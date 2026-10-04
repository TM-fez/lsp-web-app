import { describe, it, expect } from 'vitest';
import { nights, statusTone, statusLabel, isOpen, discountBlockedReason, parseDiscountInput } from './util';

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
    (['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'BLOCKED'] as const).forEach((s) => {
      expect(statusTone[s]).toBeTruthy();
    });
  });

  it('labels are human-readable', () => {
    expect(statusLabel('CHECKED_IN')).toBe('checked in');
  });

  it('names the OTA origin instead of a bare "blocked"', () => {
    expect(statusLabel('BLOCKED')).toBe('OTA block');
  });

  it('only PENDING/CONFIRMED are open for edit/cancel', () => {
    expect(isOpen('PENDING')).toBe(true);
    expect(isOpen('CONFIRMED')).toBe(true);
    expect(isOpen('CHECKED_IN')).toBe(false);
    expect(isOpen('CHECKED_OUT')).toBe(false);
    expect(isOpen('CANCELLED')).toBe(false);
    expect(isOpen('BLOCKED')).toBe(false);
  });
});

describe('discountBlockedReason', () => {
  it('lets a PENDING booking take a discount, and explains every other status', () => {
    expect(discountBlockedReason('PENDING')).toBeNull();
    expect(discountBlockedReason('CONFIRMED')).toMatch(/only be added while the booking is pending, before payment confirms it/);
    for (const s of ['CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(discountBlockedReason(s)).toMatch(/only be added while a booking is pending/);
    }
  });
});

describe('parseDiscountInput', () => {
  it('blank is "nothing yet", not an error', () => {
    expect(parseDiscountInput('PERCENT', '  ')).toEqual({ value: null, error: null });
  });
  it('percent: whole numbers 1–100 only', () => {
    expect(parseDiscountInput('PERCENT', '15')).toEqual({ value: 15, error: null });
    expect(parseDiscountInput('PERCENT', '100')).toEqual({ value: 100, error: null });
    for (const bad of ['0', '101', '12.5', '-5', '1,5', 'ten']) expect(parseDiscountInput('PERCENT', bad).value).toBeNull();
    expect(parseDiscountInput('PERCENT', '101').error).toMatch(/between 1 and 100/);
  });
  it('fixed: Pula with a dot → thebe; commas and a third decimal refused', () => {
    expect(parseDiscountInput('FIXED', '200')).toEqual({ value: 20_000, error: null });
    expect(parseDiscountInput('FIXED', '200.50')).toEqual({ value: 20_050, error: null });
    expect(parseDiscountInput('FIXED', '200,5')).toEqual({ value: null, error: 'Use a dot for decimals, e.g. 10.50' });
    expect(parseDiscountInput('FIXED', '1,200')).toEqual({ value: null, error: 'Leave out thousands separators, e.g. 1250.50' });
    expect(parseDiscountInput('FIXED', '10.005').value).toBeNull();
    expect(parseDiscountInput('FIXED', '0').error).toMatch(/above P0\.00/);
  });
});
