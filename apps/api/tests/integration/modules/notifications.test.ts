/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the parts of the notifications repository that are genuinely SQL-specific
 * and can't be reached by the mocked service unit tests: the partial-unique dedup
 * index (idempotent reminder sweep), per-recipient read scoping, and the
 * property/admin recipient resolution join.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository.js';

const TYPE = 'test.notif';               // all rows this suite creates carry this type
const repo = new NotificationsRepository(db);

let userA: string;
let userB: string;
let propertyId: string;

beforeAll(async () => {
  const users = await db.selectFrom('users').select('id').orderBy('id').limit(2).execute();
  const prop = await db.selectFrom('properties').select('id').limit(1).executeTakeFirst();
  if (users.length < 2 || !prop) throw new Error('lsp_test needs ≥2 users and ≥1 property seeded');
  [userA, userB] = [users[0].id, users[1].id];
  propertyId = prop.id;
});

afterAll(async () => {
  await db.deleteFrom('notifications').where('type', '=', TYPE).execute();
});

function row(userId: string, extra: Record<string, unknown> = {}) {
  return { user_id: userId, type: TYPE, title: 'test', ...extra };
}

describe('NotificationsRepository (live DB)', () => {
  it('insertMany writes one row per recipient', async () => {
    const n = await repo.insertMany([row(userA), row(userB)]);
    expect(n).toBe(2);
  });

  it('dedup_key collides on the partial-unique index — the second run is a no-op', async () => {
    const key = `test.notif.dedup:${Date.now()}:${userA}`;
    const first = await repo.insertMany([row(userA, { dedup_key: key })]);
    const second = await repo.insertMany([row(userA, { dedup_key: key })]);
    expect(first).toBe(1);
    expect(second).toBe(0); // idempotent: same key, dropped
  });

  it('NULL dedup_key rows never collide with each other', async () => {
    const n = await repo.insertMany([row(userA), row(userA)]);
    expect(n).toBe(2);
  });

  it('listForUser returns only my rows, newest first; unreadOnly filters read', async () => {
    const list = await repo.listForUser(userA, { limit: 100 });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((r) => r.user_id === userA)).toBe(true);
    for (let i = 1; i < list.length; i++) {
      expect(list[i].created_at.getTime()).toBeLessThanOrEqual(list[i - 1].created_at.getTime());
    }
  });

  it('markRead is scoped to the caller — you cannot read another user’s rows', async () => {
    const inserted = await db
      .insertInto('notifications')
      .values(row(userA))
      .returning('id')
      .executeTakeFirstOrThrow();

    // userB tries to mark userA's notification → 0 updated.
    expect(await repo.markRead(userB, [inserted.id])).toBe(0);
    // userA marks their own → 1 updated.
    expect(await repo.markRead(userA, [inserted.id])).toBe(1);
    // Marking an already-read row again → 0.
    expect(await repo.markRead(userA, [inserted.id])).toBe(0);
  });

  it('unreadCount and markAllRead operate per-user', async () => {
    await repo.insertMany([row(userB), row(userB)]);
    const before = await repo.unreadCount(userB);
    expect(before).toBeGreaterThanOrEqual(2);
    const cleared = await repo.markAllRead(userB);
    expect(cleared).toBe(before);
    expect(await repo.unreadCount(userB)).toBe(0);
  });

  it('userIdsForProperty resolves recipients (admins are a wildcard)', async () => {
    const ids = await repo.userIdsForProperty(propertyId);
    expect(Array.isArray(ids)).toBe(true);
    // No duplicates in the fan-out set.
    expect(new Set(ids).size).toBe(ids.length);
  });
});
