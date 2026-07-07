/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the P5.2 post-stay follow-up sweep: a completed stay gets one email a day
 * after checkout (not sooner, not once it ages out), stays without a contact email
 * are skipped, and re-runs are no-ops. The email client is injected so the send +
 * stamp path runs without a live key. sendPostStayFollowups scans the whole DB, so
 * assertions are scoped to the self-created reservations by id.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '../../../src/config/db.js';
import { sendPostStayFollowups, type PostStayEmailPort } from '../../../src/modules/notifications/reminders.js';

const day0 = new Date();
day0.setUTCHours(0, 0, 0, 0);
const checkoutDaysAgo = (n: number) => new Date(day0.getTime() - n * 86_400_000);

let userId: string;
let propId: string;
let buildingId: string;
let roomId: string;
let emailContact: string;
let noEmailContact: string;
let resWin: string;    // checked out 2 days ago, has email  -> emailed
let resFresh: string;  // checked out today, has email       -> too soon
let resOld: string;    // checked out 5 days ago, has email   -> aged out
let resNoEmail: string;// checked out 2 days ago, no email    -> skipped
const guestEmail = `guest-${Date.now()}@post-stay.test`;

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const user = await db.insertInto('users')
    .values({ role_id: role.id, name: 'PostStay Test', email: `ps-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow();
  userId = user.id;

  const prop = await db.insertInto('properties').values({ name: `PS_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  propId = prop.id;
  const building = await db.insertInto('buildings').values({ property_id: propId, name: `PS_B_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  buildingId = building.id;
  const room = await db.insertInto('rooms').values({ name: 'PS Unit', code: `PS-1-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow();
  roomId = room.id;

  const withEmail = await db.insertInto('contacts').values({ type: 'individual', name: 'Neo Guest', email: guestEmail, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow();
  emailContact = withEmail.id;
  const without = await db.insertInto('contacts').values({ type: 'individual', name: 'No Email Guest', created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow();
  noEmailContact = without.id;

  const mkRes = async (contactId: string, daysAgo: number) => {
    const r = await db.insertInto('reservations')
      .values({
        contact_id: contactId, room_id: roomId,
        check_in_date: checkoutDaysAgo(daysAgo + 2), check_out_date: checkoutDaysAgo(daysAgo),
        status: 'CHECKED_OUT', created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow();
    return r.id;
  };
  resWin = await mkRes(emailContact, 2);
  resFresh = await mkRes(emailContact, 0);
  resOld = await mkRes(emailContact, 5);
  resNoEmail = await mkRes(noEmailContact, 2);
});

afterAll(async () => {
  await db.deleteFrom('reservations').where('id', 'in', [resWin, resFresh, resOld, resNoEmail]).execute();
  await db.deleteFrom('contacts').where('id', 'in', [emailContact, noEmailContact]).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

const stampOf = async (id: string) =>
  (await db.selectFrom('reservations').select('post_stay_email_at').where('id', '=', id).executeTakeFirstOrThrow()).post_stay_email_at;

describe('Post-stay follow-up sweep (live DB)', () => {
  const sendEmail = vi.fn().mockResolvedValue({ messageId: 'x' });
  const live: PostStayEmailPort = { isEmailConfigured: () => true, sendEmail };
  const callsToGuest = () => sendEmail.mock.calls.filter((c) => (c[0] as { to: string }).to === guestEmail);

  it('does nothing when email is not configured', async () => {
    const darkSend = vi.fn();
    const n = await sendPostStayFollowups(db, { isEmailConfigured: () => false, sendEmail: darkSend });
    expect(n).toBe(0);
    expect(darkSend).not.toHaveBeenCalled();
  });

  it('emails only the stay that departed within the window, and stamps it', async () => {
    await sendPostStayFollowups(db, live);

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: guestEmail }));
    expect(callsToGuest()).toHaveLength(1);

    expect(await stampOf(resWin)).not.toBeNull();   // day-after departure → sent
    expect(await stampOf(resFresh)).toBeNull();      // same-day → too soon
    expect(await stampOf(resOld)).toBeNull();        // 5 days ago → aged out
    expect(await stampOf(resNoEmail)).toBeNull();    // no email on file → skipped
  });

  it('is idempotent — a second sweep does not re-email the same stay', async () => {
    await sendPostStayFollowups(db, live);
    expect(callsToGuest()).toHaveLength(1); // still just the one
  });
});
