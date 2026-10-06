/**
 * (Calendar, 2026-10-06) GET /reservations/calendar through the real app: logged in, the
 * active property header, the route reached before '/:id' would swallow the word
 * "calendar", and a bad date answered with a plain 400 rather than a 500.
 *
 *   DATABASE_URL=... npx vitest run --config vitest.e2e.config.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { pool } from '../../src/config/db.js';

let token = '';
let propertyId = '';

beforeAll(async () => {
  const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@lsp.local', password: 'Admin@123!' });
  expect(login.status).toBe(200);
  token = login.body.accessToken;
  const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
  propertyId = me.body.properties[0].id;
});

afterAll(async () => {
  await pool.end();
});

const get = (query: string) =>
  request(app)
    .get(`/api/v1/reservations/calendar${query}`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Property-Id', propertyId);

describe('GET /reservations/calendar', () => {
  it('returns the board for the window asked for', async () => {
    const res = await get('?from=2037-05-01&days=7');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: '2037-05-01', to: '2037-05-08' });
    expect(Array.isArray(res.body.units)).toBe(true);
    expect(Array.isArray(res.body.bookings)).toBe(true);
    expect(Array.isArray(res.body.closures)).toBe(true);
  });

  it('starts today, four weeks wide, when nothing is asked for', async () => {
    const res = await get('');
    expect(res.status).toBe(200);
    expect(res.body.from).toBe(res.body.today);
    const span = (Date.parse(res.body.to) - Date.parse(res.body.from)) / 86_400_000;
    expect(span).toBe(28);
  });

  it('answers a date that does not exist with a 400 in words', async () => {
    const res = await get('?from=2037-02-30');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/real date/);
  });
});
