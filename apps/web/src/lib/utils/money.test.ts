import { describe, it, expect } from 'vitest';
import { isPulaAmount } from './money';

describe('isPulaAmount', () => {
  it('accepts whole pula and up to two decimals (with thousands commas)', () => {
    for (const ok of ['10', '10.5', '10.05', '1,250.50', ' 7 ']) expect(isPulaAmount(ok)).toBe(true);
  });
  // Re-test 3: "10.005" was taken and rounded to an amount the operator never typed.
  it('refuses a third decimal place, negatives and junk', () => {
    for (const bad of ['10.005', '-5', 'abc', '', '1.2.3']) expect(isPulaAmount(bad)).toBe(false);
  });
});
