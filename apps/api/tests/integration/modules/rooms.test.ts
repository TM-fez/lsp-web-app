import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createRoomsRouter } from '../../../src/modules/rooms/rooms.routes';

const app = express();
app.use(express.json());

// Mock middleware to set req.user for testing
app.use((req, res, next) => {
  (req as any).user = { sub: 'test-user-id', role: 'admin', permissions: ['rooms.read', 'rooms.create'] };
  (req as any).id = 'test-request-id';
  next();
});

app.use('/api/rooms', createRoomsRouter({} as any));

// NOTE: lightweight wiring smoke tests that run without a database.
// The router applies `authenticate`, so requests without a valid Bearer token are
// rejected with 401 before reaching the controller/repository. Full CRUD coverage
// (200/201/400/404/409) requires a live Postgres — see the Sprint 3 DB-backed flow.
describe('Rooms Integration', () => {
  it('protects the list endpoint — returns 401 without authentication', async () => {
    const res = await request(app).get('/api/rooms');
    expect(res.status).toBe(401);
  });

  it('protects /available — returns 401 without authentication', async () => {
    const res = await request(app).get('/api/rooms/available');
    expect(res.status).toBe(401);
  });
});
