/**
 * Integration test for the per-unit iCal EXPORT feed (GET /api/v1/ical/units/:token).
 *
 * The one bug this guards against: a Booking.com-sourced BLOCKED row leaking back into
 * the export feed, which would echo an OTA's own booking to it (a feedback loop). This
 * test inserts both a DIRECT confirmed stay and a BOOKING_COM BLOCKED block on the same
 * unit, then asserts the feed publishes the first and NEVER the second.
 *
 * Requires PostgreSQL with migrations applied (through 046).
 *   Start test DB:  docker compose -f infra/docker-compose.test.yml up -d
 *   Run migrations: DATABASE_URL=postgresql://lsp:lsp@localhost:5433/lsp_test npm run db:migrate
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { db, pool } from '../../../src/config/db.js';
import { icalUid } from '../../../src/modules/channel/channel.types.js';

// Inserted directly via the DB (not the API) on purpose: the API will not let a caller
// set status=BLOCKED or source=BOOKING_COM — which is exactly the state we must test.
let userId = '';
let contactId = '';
let roomId = '';
let token = '';
let directResId = '';
let blockedResId = '';
// (Audit M-1) Desk bookings, and a claimed Booking.com booking that must still not echo.
let walkInResId = '';
let phoneResId = '';
let claimedOtaResId = '';

const BLOCKED_UID = `evt-booking-${Date.now()}`;

// Future-dated so they survive the feed's "check_out_date >= today" filter whenever the
// suite runs. Dates are handled as bare calendar days end-to-end (no time-of-day), so
// the test can't drift across a timezone boundary: we store them as `::date` literals
// and assert with local components — exactly how the iCal serializer formats them.
const pad = (n: number) => String(n).padStart(2, '0');
function plusDays(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}
// 'YYYY-MM-DD' for the SQL literal, 'YYYYMMDD' for the iCal assertion — both local.
function ymdDash(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
const asDate = (d: Date) => sql<Date>`${ymdDash(d)}::date`;

const directIn = plusDays(10);
const directOut = plusDays(14);
const blockedIn = plusDays(40);
const blockedOut = plusDays(42);
const walkInIn = plusDays(60);
const walkInOut = plusDays(62);
const phoneIn = plusDays(70);
const phoneOut = plusDays(71);
const claimedIn = plusDays(80);
const claimedOut = plusDays(83);

beforeAll(async () => {
  const role = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', 'admin')
    .executeTakeFirstOrThrow();

  const user = await db
    .insertInto('users')
    .values({
      role_id: role.id,
      name: 'Channel Export Test',
      email: `channel-export-${Date.now()}@lsp.test`,
      password_hash: 'not-used',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  userId = user.id;

  const room = await db
    .insertInto('rooms')
    .values({
      name: 'Channel Export Unit',
      code: `CXP-${Date.now()}`,
      type: 'STANDARD',
      status: 'AVAILABLE',
      capacity: 2,
      created_by: userId,
      updated_by: userId,
    })
    .returning(['id', 'ical_token'])
    .executeTakeFirstOrThrow();
  roomId = room.id;
  token = room.ical_token;

  const contact = await db
    .insertInto('contacts')
    .values({ type: 'individual', name: 'Export Guest', created_by: userId, updated_by: userId })
    .returning('id')
    .executeTakeFirstOrThrow();
  contactId = contact.id;

  const direct = await db
    .insertInto('reservations')
    .values({
      contact_id: contactId,
      room_id: roomId,
      check_in_date: asDate(directIn),
      check_out_date: asDate(directOut),
      status: 'CONFIRMED',
      source: 'DIRECT',
      created_by: userId,
      updated_by: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  directResId = direct.id;

  const blocked = await db
    .insertInto('reservations')
    .values({
      contact_id: contactId,
      room_id: roomId,
      check_in_date: asDate(blockedIn),
      check_out_date: asDate(blockedOut),
      status: 'BLOCKED',
      source: 'BOOKING_COM',
      external_uid: BLOCKED_UID,
      created_by: userId,
      updated_by: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  blockedResId = blocked.id;

  const stay = async (source: 'WALK_IN' | 'PHONE' | 'BOOKING_COM', status: 'PENDING' | 'CONFIRMED', from: Date, to: Date) =>
    (await db
      .insertInto('reservations')
      .values({
        contact_id: contactId, room_id: roomId, check_in_date: asDate(from), check_out_date: asDate(to),
        status, source, created_by: userId, updated_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()).id;
  walkInResId = await stay('WALK_IN', 'PENDING', walkInIn, walkInOut);
  phoneResId = await stay('PHONE', 'CONFIRMED', phoneIn, phoneOut);
  claimedOtaResId = await stay('BOOKING_COM', 'CONFIRMED', claimedIn, claimedOut);
});

afterAll(async () => {
  if (directResId || blockedResId || walkInResId) {
    await db
      .deleteFrom('reservations')
      .where('id', 'in', [directResId, blockedResId, walkInResId, phoneResId, claimedOtaResId].filter(Boolean))
      .execute();
  }
  if (contactId) await db.deleteFrom('contacts').where('id', '=', contactId).execute();
  if (roomId) await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  if (userId) await db.deleteFrom('users').where('id', '=', userId).execute();
  await pool.end();
});

describe('GET /api/v1/ical/units/:token (export feed)', () => {
  it('serves a text/calendar document for a valid unit token (with .ics suffix)', async () => {
    const res = await request(app).get(`/api/v1/ical/units/${token}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
  });

  it('publishes the DIRECT confirmed stay', async () => {
    const res = await request(app).get(`/api/v1/ical/units/${token}`);
    expect(res.text).toContain(`UID:${icalUid(directResId)}`);
    expect(res.text).toContain(`DTSTART;VALUE=DATE:${ymd(directIn)}`);
    expect(res.text).toContain(`DTEND;VALUE=DATE:${ymd(directOut)}`);
  });

  it('NEVER leaks a Booking.com-sourced BLOCKED row back into the feed (no OTA loop)', async () => {
    const res = await request(app).get(`/api/v1/ical/units/${token}`);
    // None of: the OTA event UID, the reservation's own UID, or its date range.
    expect(res.text).not.toContain(BLOCKED_UID);
    expect(res.text).not.toContain(`UID:${icalUid(blockedResId)}`);
    expect(res.text).not.toContain(`DTSTART;VALUE=DATE:${ymd(blockedIn)}`);
  });

  // (Audit 2026-10-11, M-1) The feed used to publish only DIRECT and WEBSITE. The staff form
  // defaults to WALK_IN, so desk bookings never reached Booking.com — which sold them again.
  it('publishes desk bookings of every source — walk-in, phone — including unpaid PENDING', async () => {
    const res = await request(app).get(`/api/v1/ical/units/${token}`);
    expect(res.text).toContain(`UID:${icalUid(walkInResId)}`);
    expect(res.text).toContain(`DTSTART;VALUE=DATE:${ymd(walkInIn)}`);
    expect(res.text).toContain(`UID:${icalUid(phoneResId)}`);
  });

  it('still never echoes a claimed (CONFIRMED) Booking.com booking back to Booking.com', async () => {
    const res = await request(app).get(`/api/v1/ical/units/${token}`);
    expect(res.text).not.toContain(`UID:${icalUid(claimedOtaResId)}`);
    expect(res.text).not.toContain(`DTSTART;VALUE=DATE:${ymd(claimedIn)}`);
  });

  it('never exposes guest PII — only "Not available"', async () => {
    const res = await request(app).get(`/api/v1/ical/units/${token}`);
    expect(res.text).not.toContain('Export Guest');
    expect(res.text).toContain('SUMMARY:Not available');
  });

  it('404s on an unknown but well-formed token', async () => {
    const res = await request(app).get('/api/v1/ical/units/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
