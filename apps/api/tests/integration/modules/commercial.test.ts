import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { createPricingRouter } from '../../../../src/modules/pricing/pricing.routes.js';
import { createQuotesRouter } from '../../../../src/modules/quotes/quotes.routes.js';
import { createHoldsRouter } from '../../../../src/modules/holds/holds.routes.js';
import { createPaymentsRouter } from '../../../../src/modules/payments/payments.routes.js';
import { createInvoicesRouter } from '../../../../src/modules/invoices/invoices.routes.js';
import { errorHandler } from '../../../../src/core/errors/errorHandler.middleware.js';

// Hoisted mutable auth state for the jwt mock.
const mockState = vi.hoisted(() => ({ user: null as any }));

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: () => {
      if (!mockState.user) throw new Error('jwt malformed');
      return mockState.user;
    },
  },
}));

// Permission-aware authorize mock (mirrors the maintenance integration test).
vi.mock('../../../../src/core/auth/authorize.middleware.js', () => ({
  authorize: (permission: string) => (req: Request, res: Response, next: NextFunction) => {
    const perms = (req as any).user?.permissions || [];
    if (!perms.includes(permission)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const app = express();
app.use(express.json());
app.use('/api/pricing', createPricingRouter());
app.use('/api/quotes', createQuotesRouter());
app.use('/api/holds', createHoldsRouter());
app.use('/api/payments', createPaymentsRouter());
app.use('/api/invoices', createInvoicesRouter());
app.use(errorHandler);

describe('Commercial Core — wiring, auth & RBAC', () => {
  beforeEach(() => {
    mockState.user = null;
  });

  it('mounts all five commercial routers and rejects unauthenticated pricing', async () => {
    expect((await request(app).get('/api/pricing')).status).toBe(401);
  });

  it('rejects unauthenticated quote listing', async () => {
    expect((await request(app).get('/api/quotes')).status).toBe(401);
  });

  it('returns 403 creating a quote without quotes.create', async () => {
    mockState.user = { sub: 'u1', permissions: ['quotes.read'] };
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', 'Bearer t')
      .send({ unit_type: 'STANDARD', check_in: '2026-01-01', check_out: '2026-01-04', guests: 1 });
    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid rate plan body (permission present)', async () => {
    mockState.user = { sub: 'u1', permissions: ['pricing.create'] };
    const res = await request(app)
      .post('/api/pricing')
      .set('Authorization', 'Bearer t')
      .send({ name: 'Missing rates' });
    expect(res.status).toBe(400);
  });

  it('returns 403 taking a payment without payments.create', async () => {
    mockState.user = { sub: 'u1', permissions: ['payments.read'] };
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', 'Bearer t')
      .send({ hold_id: '00000000-0000-0000-0000-000000000000', method: 'CASH' });
    expect(res.status).toBe(403);
  });

  it('returns 403 refunding an invoice without invoices.refund', async () => {
    mockState.user = { sub: 'u1', permissions: ['invoices.read', 'invoices.update'] };
    const res = await request(app)
      .post('/api/invoices/00000000-0000-0000-0000-000000000000/refund')
      .set('Authorization', 'Bearer t')
      .send({ amount: 1000, reason: 'test' });
    expect(res.status).toBe(403);
  });

  it('passes RBAC for a permitted quote create (then fails downstream without a DB)', async () => {
    mockState.user = { sub: 'u1', permissions: ['quotes.create'] };
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', 'Bearer t')
      .send({ unit_type: 'STANDARD', check_in: '2026-01-01', check_out: '2026-01-04', guests: 1 });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
