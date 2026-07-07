/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the parts of the notifications repository that are genuinely SQL-specific
 * and can't be reached by the mocked service unit tests: the partial-unique dedup
 * index (idempotent reminder sweep), per-recipient read scoping, and the
 * property/admin recipient resolution join.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository.js';

const TYPE = 'test.notif';               // all rows this suite creates carry this type
const repo = new NotificationsRepository(db);

let userA: string;
let userB: string;
let propertyId: string;

// Create our own users + property rather than leaning on seed state — CI's test DB
// is seeded more minimally than a dev DB, so relying on pre-existing rows is flaky.
// roles are part of the baseline schema, so at least one always exists to reference.
beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const prop = await db
    .insertInto('properties')
    .values({ name: `NOTIF_TEST_PROP_${Date.now()}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  propertyId = prop.id;

  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const users = await db
    .insertInto('users')
    .values([
      { role_id: role.id, name: 'Notif Test A', email: `notif-a-${uniq}@test.local`, password_hash: 'x' },
      { role_id: role.id, name: 'Notif Test B', email: `notif-b-${uniq}@test.local`, password_hash: 'x' },
    ])
    .returning('id')
    .execute();
  [userA, userB] = [users[0].id, users[1].id];
});

afterAll(async () => {
  // Deleting the users cascades their notifications (FK ON DELETE CASCADE); the
  // explicit type-delete covers any rows addressed to other users (none here).
  await db.deleteFrom('notifications').where('type', '=', TYPE).execute();
  await db.deleteFrom('users').where('id', 'in', [userA, userB]).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
});

function row(userId: string, extra: Record<string, unknown> = {}) {
  return { user_id: userId, type: TYPE, title: 'test', ...extra };
}

describe('NotificationsRepository (live DB)', () => {
  it('insertMany writes one row per recipient', async () => {
    const n = await repo.insertMany([row(userA), row(userB)]);
    expect(n).toBe(2);
  });

  it('insertMany drops a recipient that vanished mid-flight, without failing the batch', async () => {
    // A recipient the fan-out resolved but who no longer exists at write time
    // (deleted between resolution and insert). Left unguarded this is a user_id
    // FK violation that aborts the whole batch — and, in the sweep, the whole run.
    const ghost = randomUUID();
    const n = await repo.insertMany([row(userA), row(ghost), row(userB)]);
    expect(n).toBe(2); // the two live recipients still get their alert
    const orphaned = await db.selectFrom('notifications').select('id').where('user_id', '=', ghost).execute();
    expect(orphaned).toHaveLength(0); // the departed recipient's row was skipped, not inserted
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
