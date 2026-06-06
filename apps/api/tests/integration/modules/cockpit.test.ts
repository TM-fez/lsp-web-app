import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { createHousekeepingRouter } from '../../../src/modules/housekeeping/housekeeping.routes.js';
import { createCockpitRouter } from '../../../src/modules/cockpit/cockpit.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';

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

// Permission-aware authorize mock (mirrors the commercial integration test).
vi.mock('../../../src/core/auth/authorize.middleware.js', () => ({
  authorize: (permission: string) => (req: Request, res: Response, next: NextFunction) => {
    const perms = (req as any).user?.permissions || [];
    if (!perms.includes(permission)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const app = express();
app.use(express.json());
app.use('/api/housekeeping', createHousekeepingRouter());
app.use('/api/cockpit', createCockpitRouter());
app.use(errorHandler);

describe('Operations Cockpit — wiring, auth & RBAC', () => {
  beforeEach(() => {
    mockState.user = null;
  });

  it('rejects the unauthenticated board', async () => {
    expect((await request(app).get('/api/cockpit/board')).status).toBe(401);
  });

  it('returns 403 reading the board without cockpit.read', async () => {
    mockState.user = { sub: 'u1', permissions: ['housekeeping.read'] };
    const res = await request(app).get('/api/cockpit/board').set('Authorization', 'Bearer t');
    expect(res.status).toBe(403);
  });

  it('rejects the unauthenticated housekeeping queue', async () => {
    expect((await request(app).get('/api/housekeeping/queue')).status).toBe(401);
  });

  it('returns 403 starting a turn without housekeeping.update', async () => {
    mockState.user = { sub: 'u1', permissions: ['housekeeping.read'] };
    const res = await request(app)
      .post('/api/housekeeping/rooms/00000000-0000-0000-0000-000000000000/start')
      .set('Authorization', 'Bearer t')
      .send({});
    expect(res.status).toBe(403);
  });

  it('passes RBAC for a permitted board read (then fails downstream without a DB)', async () => {
    mockState.user = { sub: 'u1', permissions: ['cockpit.read'] };
    const res = await request(app).get('/api/cockpit/board').set('Authorization', 'Bearer t');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
