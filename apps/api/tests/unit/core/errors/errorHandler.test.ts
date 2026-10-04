import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { errorHandler } from '../../../../src/core/errors/errorHandler.middleware.js';

// Re-test 2026-10-04: malformed input still reached the 500 branch, which outside
// production echoes raw Postgres text. Each of these is the caller's mistake → 4xx.

function run(err: unknown) {
  const res = { locals: {}, status: vi.fn(), json: vi.fn() } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  errorHandler(err, { method: 'GET', originalUrl: '/x' } as Request, res, () => {});
  return { status: res.status.mock.calls[0]![0] as number, body: res.json.mock.calls[0]![0] as { message: string } };
}

const pg = (code: string, detail?: string) => Object.assign(new Error('raw postgres text'), { code, detail });

describe('errorHandler — bad input is a 4xx, never raw database text', () => {
  it.each([
    ['2201W', 'positive'],      // LIMIT -5
    ['2201X', 'positive'],      // OFFSET -5
    ['22003', 'too large'],     // number overflow
    ['22021', 'characters'],    // NUL byte in a search box
    ['22001', 'too long'],
    ['22P02', 'right format'],  // /invoices/abc
  ])('maps Postgres %s to 400', (code, words) => {
    const { status, body } = run(pg(code));
    expect(status).toBe(400);
    expect(body.message).toContain(words);
    expect(body.message).not.toContain('raw postgres');
  });

  it('maps a reference to a missing row to 400, but not a delete of a row still in use', () => {
    expect(run(pg('23503', 'Key (property_id)=(x) is not present in table "properties".')).status).toBe(400);
    expect(run(pg('23503', 'Key (id)=(x) is still referenced from table "rooms".')).status).toBe(500);
  });

  it('passes through body-parser refusals: oversized body → 413', () => {
    const { status, body } = run(Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 }));
    expect(status).toBe(413);
    expect(body.message).toMatch(/too large/);
  });
});
