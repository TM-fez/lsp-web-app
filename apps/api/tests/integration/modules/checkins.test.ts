import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createCheckinsRouter } from '../../../src/modules/checkins/checkins.routes';

const app = express();
app.use(express.json());

// Mock middleware to set req.user for testing
app.use((req, res, next) => {
  (req as any).user = { sub: 'test-user-id', role: 'admin', permissions: ['checkins.read', 'checkins.create'] };
  (req as any).id = 'test-request-id';
  next();
});

app.use('/api/checkins', createCheckinsRouter({} as any));

// NOTE: lightweight wiring smoke tests that run without a database.
// The router applies `authenticate`, so requests without a valid Bearer token are
// rejected with 401 before reaching the controller/repository. Full occupancy
// coverage requires a live Postgres — see the Sprint 4 DB-backed flow.
describe('Checkins Integration', () => {
  it('protects the list endpoint — returns 401 without authentication', async () => {
    const res = await request(app).get('/api/checkins');
    expect(res.status).toBe(401);
  });

  it('protects /active — returns 401 without authentication', async () => {
    const res = await request(app).get('/api/checkins/active');
    expect(res.status).toBe(401);
  });
});
