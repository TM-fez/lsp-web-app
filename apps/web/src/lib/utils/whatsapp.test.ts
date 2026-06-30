import { describe, it, expect } from 'vitest';
import { normalizePhone, whatsappLink } from './whatsapp';

describe('normalizePhone', () => {
  it('prepends the Botswana country code to a bare local mobile', () => {
    expect(normalizePhone('71 234 567')).toBe('26771234567');
  });

  it('drops a leading trunk 0 before prepending the country code', () => {
    expect(normalizePhone('071234567')).toBe('26771234567');
  });

  it('keeps a number that already has the country code', () => {
    expect(normalizePhone('267 71 234 567')).toBe('26771234567');
  });

  it('handles a +country-code number and strips punctuation', () => {
    expect(normalizePhone('+267 (71) 234-567')).toBe('26771234567');
  });

  it('strips a 00 international prefix', () => {
    expect(normalizePhone('0026771234567')).toBe('26771234567');
  });

  it('returns null for empty / nullish / non-numeric input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone('no digits here')).toBeNull();
  });

  it('returns null for an implausibly short number', () => {
    expect(normalizePhone('123')).toBeNull();
  });
});

describe('whatsappLink', () => {
  it('builds a wa.me link from a usable number', () => {
    expect(whatsappLink('71234567')).toBe('https://wa.me/26771234567');
  });

  it('appends a url-encoded prefilled message', () => {
    expect(whatsappLink('71234567', 'Hi Kefilwe!')).toBe(
      'https://wa.me/26771234567?text=Hi%20Kefilwe!',
    );
  });

  it('returns null when there is no usable number', () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink('abc')).toBeNull();
  });
});
