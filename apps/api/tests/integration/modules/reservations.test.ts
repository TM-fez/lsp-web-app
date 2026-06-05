import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createReservationsRouter } from '../../../src/modules/reservations/reservations.routes';

const app = express();
app.use(express.json());

// Mock middleware to set req.user for testing
app.use((req, res, next) => {
  (req as any).user = { id: 'test-user-id', role: 'admin', permissions: ['reservations.read', 'reservations.create'] };
  (req as any).id = 'test-request-id';
  next();
});

// Assuming a mocked db or test db instance
app.use('/api/reservations', createReservationsRouter({} as any)); 

// NOTE: These are lightweight wiring smoke tests that run without a database.
// The router applies `authenticate`, so requests without a valid Bearer token are
// rejected with 401 before reaching the controller/repository. Full CRUD coverage
// (200/201/400/404/409) requires a live Postgres — see auth/dashboard integration tests.
describe('Reservations Integration', () => {
  it('protects /availability — returns 401 without authentication', async () => {
    const res = await request(app).get('/api/reservations/availability');
    expect(res.status).toBe(401);
  });

  it('protects the list endpoint — returns 401 without authentication', async () => {
    const res = await request(app).get('/api/reservations');
    expect(res.status).toBe(401);
  });
});
