import { describe, it, expect } from 'vitest';
import { hashRequest, isValidIdempotencyKey, stableStringify } from '../../../src/core/middleware/idempotency.middleware';

describe('Idempotency-Key helpers', () => {
  it('accepts UUIDs and url-safe tokens of 8–128 characters', () => {
    expect(isValidIdempotencyKey('3f2b8a52-6c1d-4e5f-9a77-0b1c2d3e4f50')).toBe(true);
    expect(isValidIdempotencyKey('refund_2026-10-04:abc.DEF')).toBe(true);
    expect(isValidIdempotencyKey('a'.repeat(128))).toBe(true);
  });

  it.each(['', 'short', 'a'.repeat(129), 'has space in it', 'semi;colon-key', 'émoji-key-12345', "quote'key-12345", 'new\nline-12345'])(
    'rejects %j',
    (key) => {
      expect(isValidIdempotencyKey(key)).toBe(false);
    }
  );

  it('stableStringify ignores key order and undefined fields, but not values or array order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [1, 2] } })).toBe(stableStringify({ a: { c: [1, 2], d: 2 }, b: 1 }));
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(stableStringify({ a: [1, 2] })).not.toBe(stableStringify({ a: [2, 1] }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: '1' }));
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
  });

  const base = { method: 'POST', route: '/api/v1/invoices/:id/refund', params: { id: 'inv-1' }, propertyId: 'p1', body: { amount: 10_000, reason: 'x' } };
  it('hashes the same request to the same value regardless of body key order', () => {
    expect(hashRequest(base)).toBe(hashRequest({ ...base, body: { reason: 'x', amount: 10_000 } }));
  });
  it('a different amount, invoice, route or property is a different request', () => {
    const h = hashRequest(base);
    expect(hashRequest({ ...base, body: { ...base.body, amount: 10_001 } })).not.toBe(h);
    expect(hashRequest({ ...base, params: { id: 'inv-2' } })).not.toBe(h);
    expect(hashRequest({ ...base, route: '/api/v1/payments' })).not.toBe(h);
    expect(hashRequest({ ...base, propertyId: 'p2' })).not.toBe(h);
  });
});
