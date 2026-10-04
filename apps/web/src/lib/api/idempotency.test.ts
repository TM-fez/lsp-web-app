import { describe, it, expect, vi, afterEach } from 'vitest';
import { idempotencyConfig, newIdempotencyKey } from './idempotency';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newIdempotencyKey', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes a UUID, different every time', () => {
    const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey));
    expect(keys.size).toBe(50);
    for (const k of keys) expect(k).toMatch(UUID);
  });

  it('still makes a valid key where crypto.randomUUID is unavailable (plain http)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(7) });
    expect(newIdempotencyKey()).toMatch(UUID);
    vi.stubGlobal('crypto', undefined);
    expect(newIdempotencyKey()).toMatch(UUID);
  });

  it('satisfies the server’s key rule (8–128 url-safe characters)', () => {
    expect(newIdempotencyKey()).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
  });
});

describe('idempotencyConfig', () => {
  it('sets the header when there is a key and sends nothing extra when there is not', () => {
    expect(idempotencyConfig('abc-12345')).toEqual({ headers: { 'Idempotency-Key': 'abc-12345' } });
    expect(idempotencyConfig(undefined)).toBeUndefined();
    expect(idempotencyConfig('')).toBeUndefined();
  });
});
