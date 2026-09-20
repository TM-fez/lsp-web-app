import { describe, it, expect } from 'vitest';
import { isValidEmail } from './validation';

describe('isValidEmail', () => {
  it('accepts a normal address', () => {
    expect(isValidEmail('you@example.com')).toBe(true);
    expect(isValidEmail('  naledi.moeng@lifestyle.co.bw  ')).toBe(true);
  });

  it('rejects too-short or malformed values', () => {
    expect(isValidEmail('a')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('missing@domain')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
  });
});
