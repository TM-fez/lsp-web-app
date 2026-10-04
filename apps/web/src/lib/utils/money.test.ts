import { describe, it, expect } from 'vitest';
import { isPulaAmount, pulaAmountError, pulaToThebe, thebeToPula } from './money';

describe('pulaToThebe (strict — Round 4 N-2)', () => {
  it('converts whole pula and up to two decimals exactly', () => {
    expect(pulaToThebe('10')).toBe(1000);
    expect(pulaToThebe('10.5')).toBe(1050);
    expect(pulaToThebe('10.05')).toBe(1005);
    expect(pulaToThebe('0.07')).toBe(7);
    expect(pulaToThebe(' 7 ')).toBe(700);
    expect(pulaToThebe('1250.50')).toBe(125_050);
  });
  it('is exact where floating point is not', () => {
    expect(pulaToThebe('1.15')).toBe(115); // 1.15 * 100 === 114.99999999999999
    expect(pulaToThebe('4.35')).toBe(435);
    expect(pulaToThebe('0.29')).toBe(29);
  });
  it('a decimal comma is NaN — "10,5" must never become P105.00', () => {
    expect(pulaToThebe('10,5')).toBeNaN();
    expect(pulaToThebe('10,50')).toBeNaN();
    expect(pulaToThebe('0,5')).toBeNaN();
  });
  it('thousands separators are NaN', () => {
    for (const bad of ['1,250', '1,250.50', '1 250', "1'250", '12,345,678']) expect(pulaToThebe(bad)).toBeNaN();
  });
  it('blank, signs, junk and a third decimal are NaN', () => {
    for (const bad of ['', '  ', '-5', '+5', 'abc', '1.2.3', '10.005', '.5', '5.', '1e3', 'P10', '10 BWP']) expect(pulaToThebe(bad)).toBeNaN();
  });
  it('a number is rounded to the thebe; non-finite is NaN', () => {
    expect(pulaToThebe(10.5)).toBe(1050);
    expect(pulaToThebe(Number.NaN)).toBeNaN();
    expect(pulaToThebe(Infinity)).toBeNaN();
  });
  it('round-trips with thebeToPula', () => {
    for (const thebe of [0, 1, 7, 99, 100, 101, 12_345, 100_000_000]) expect(pulaToThebe(thebeToPula(thebe))).toBe(thebe);
  });
});

describe('isPulaAmount', () => {
  it('accepts whole pula and up to two decimals with a dot', () => {
    for (const ok of ['10', '10.5', '10.05', '1250.50', ' 7 ']) expect(isPulaAmount(ok)).toBe(true);
  });
  it('refuses commas of any kind, a third decimal place, negatives and junk', () => {
    for (const bad of ['10,5', '1,250.50', '10.005', '-5', 'abc', '', '1.2.3']) expect(isPulaAmount(bad)).toBe(false);
  });
});

describe('pulaAmountError — the sentence shown under the field', () => {
  it('a decimal comma says to use a dot', () => {
    expect(pulaAmountError('10,5')).toBe('Use a dot for decimals, e.g. 10.50');
    expect(pulaAmountError('10,50')).toBe('Use a dot for decimals, e.g. 10.50');
  });
  it('thousands separators say to leave them out', () => {
    expect(pulaAmountError('1,250')).toBe('Leave out thousands separators, e.g. 1250.50');
    expect(pulaAmountError('1,250.50')).toBe('Leave out thousands separators, e.g. 1250.50');
    expect(pulaAmountError('1 250')).toBe('Leave out thousands separators, e.g. 1250.50');
  });
  it('other comma shapes get the combined hint', () => {
    expect(pulaAmountError('1,2,3')).toBe('Use a dot for decimals and no thousands separators, e.g. 10.50');
  });
  it('other problems get their own words; fine or blank input has none', () => {
    expect(pulaAmountError('10.005')).toMatch(/at most two decimal places/);
    expect(pulaAmountError('-5')).toMatch(/negative/);
    expect(pulaAmountError('abc')).toMatch(/Enter an amount in Pula/);
    expect(pulaAmountError('')).toBeNull();
    expect(pulaAmountError('  ')).toBeNull();
    expect(pulaAmountError('10.5')).toBeNull();
    expect(pulaAmountError('10')).toBeNull();
  });
  it('agrees with pulaToThebe: an error exactly when a non-blank value would be NaN', () => {
    for (const v of ['10', '10.5', '10,5', '1,250', '10.005', '-5', 'x', '1.2.3', '0.07']) {
      expect(pulaAmountError(v) === null).toBe(!Number.isNaN(pulaToThebe(v)));
    }
  });
});
