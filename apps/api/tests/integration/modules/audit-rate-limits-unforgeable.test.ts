/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit 2026-10-11, needs-checking #1) Every public limit was per IP, and req.ip comes from
 * X-Forwarded-For. Whether a caller going straight to the Render address can forge that was
 * never verified on live. These tests forge a fresh address on EVERY request — the worst case
 * — and show the limits still hold, because each is backed by one keyed on something the
 * caller can't forge.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createPublicRouter } from '../../../src/modules/public/public.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

const app = express();
app.set('trust proxy', true); // the worst case: every forged X-Forwarded-For is believed
app.use(express.json());
app.use('/public', createPublicRouter(db));
app.use(errorHandler);

let n = 0;
const fakeIp = () => `203.0.113.${(n++ % 250) + 1}`;
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// An invalid layout: refused with a 400 before anything is written, but the limiters count it.
const booking = (email: string) =>
  request(app).post('/public/bookings').set('X-Forwarded-For', fakeIp())
    .send({ unit_type: 'NOPE', check_in: '2030-01-01', check_out: '2030-01-03', name: 'X', email, phone: '+26771000000' });

describe('public limits hold even when every request forges a new IP', () => {
  it('booking lookups are limited per email (code guessing)', async () => {
    const email = `victim-${uniq}@t.local`;
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await request(app).get(`/public/bookings/lookup?code=00000${i % 10}&email=${email}`).set('X-Forwarded-For', fakeIp())).status);
    }
    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  });

  it('one email can’t be sent a stream of bookings', async () => {
    const email = `target-${uniq}@t.local`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await booking(email)).status);
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
  });

  it('fresh emails still hit the site-wide ceiling on online bookings', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await booking(`fresh-${i}-${uniq}@t.local`)).status);
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s !== 429).length).toBeLessThanOrEqual(20);
  });

  it('one QR sticker can’t be hammered', async () => {
    const token = '00000000-0000-4000-a000-0000000000ff';
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await request(app).get(`/public/checkin?token=${token}`).set('X-Forwarded-For', fakeIp())).status);
    expect(statuses[20]).toBe(429);
  });
});
