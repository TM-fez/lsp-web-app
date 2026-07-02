import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  requireInActiveProperty,
  requireBodyRefInActiveProperty,
} from '../../../src/core/scope/propertyOf.js';
import { AppError } from '../../../src/core/errors/AppError.js';

const db = {} as never; // resolvers are injected below; the db handle is never touched

function run(mw: ReturnType<typeof requireInActiveProperty>, req: Partial<Request>) {
  return new Promise<unknown>((resolve) => {
    void mw(req as Request, {} as Response, (err?: unknown) => resolve(err));
  });
}

describe('requireInActiveProperty', () => {
  it('passes when the entity resolves to the active property', async () => {
    const mw = requireInActiveProperty(db, vi.fn().mockResolvedValue('prop-1'), 'Hold');
    const err = await run(mw, { params: { id: 'h1' }, activePropertyId: 'prop-1' } as never);
    expect(err).toBeUndefined();
  });

  it('404s (never 403s) for an entity in ANOTHER property', async () => {
    const mw = requireInActiveProperty(db, vi.fn().mockResolvedValue('prop-2'), 'Hold');
    const err = await run(mw, { params: { id: 'h1' }, activePropertyId: 'prop-1' } as never);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(404);
  });

  it('404s for an entity outside every property (null chain)', async () => {
    const mw = requireInActiveProperty(db, vi.fn().mockResolvedValue(null), 'Hold');
    const err = await run(mw, { params: { id: 'h1' }, activePropertyId: 'prop-1' } as never);
    expect((err as AppError).statusCode).toBe(404);
  });
});

describe('requireBodyRefInActiveProperty', () => {
  it('validates a present reference against the active property', async () => {
    const mw = requireBodyRefInActiveProperty(db, 'hold_id', vi.fn().mockResolvedValue('prop-2'), 'Hold');
    const err = await run(mw, { body: { hold_id: 'h1' }, activePropertyId: 'prop-1' } as never);
    expect((err as AppError).statusCode).toBe(404);
  });

  it('skips silently when the field is absent — schema validation owns "required"', async () => {
    const resolve = vi.fn();
    const mw = requireBodyRefInActiveProperty(db, 'room_id', resolve, 'Room');
    const err = await run(mw, { body: {}, activePropertyId: 'prop-1' } as never);
    expect(err).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });
});
