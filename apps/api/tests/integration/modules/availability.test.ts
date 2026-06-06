import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { createAvailabilityRouter } from '../../../src/modules/availability/availability.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';

// Auth harness: the router applies the real `authenticate` middleware, which
// reads the Bearer token (not a pre-set req.user). Mock jwt verification so an
// authenticated request resolves to a test user, and mock `authorize` to gate on
// that user's permissions — mirroring the maintenance integration harness.
const mockState = vi.hoisted(() => ({ user: null as any }));

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: () => {
      if (!mockState.user) throw new Error('jwt malformed');
      return mockState.user;
    },
  },
}));

vi.mock('../../../src/core/auth/authorize.middleware.js', () => ({
  authorize: (permission: string) => (req: Request, res: Response, next: NextFunction) => {
    const perms = (req as any).user?.permissions || [];
    if (!perms.includes(permission)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

// `{} as any` db is never reached: every assertion here fails validation first.
// The real errorHandler maps ZodError -> 400.
const app = express();
app.use(express.json());
app.use('/api/availability', createAvailabilityRouter({} as any));
app.use(errorHandler);

describe('Availability Integration', () => {
  beforeEach(() => {
    mockState.user = { sub: 'test-user-id', role: 'admin', permissions: ['availability.read'] };
  });

  it('returns 401 when unauthenticated', async () => {
    mockState.user = null;
    const res = await request(app).post('/api/availability/quote').send({});
    expect(res.status).toBe(401);
  });

  it('should return 400 for quote with missing range', async () => {
    const res = await request(app)
      .post('/api/availability/quote')
      .set('Authorization', 'Bearer t')
      .send({});
    expect(res.status).toBe(400);
  });

  it('should return 400 for calendar with inverted dates', async () => {
    const res = await request(app)
      .get('/api/availability/calendar?check_in=2026-10-10&check_out=2026-10-05')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(400);
  });
});
