/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R5 retest, migration 088) A property's feed must not go blank because ANOTHER property
 * has been busy. Before, a CBD-only user's feed resolved the newest ~8,000 rows of every
 * property one by one, and with that many newer Village changes it returned nothing.
 * Audit rows now carry their property (set by trigger), so the feed reads CBD's own rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { ActivityRepository } from '../../../src/modules/activity/activity.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string;
const props: string[] = [], blds: string[] = [], rooms: string[] = [];

async function unit(label: string) {
  const p = (await db.insertInto('properties').values({ name: `ABP_${label}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  const b = (await db.insertInto('buildings').values({ property_id: p, name: `ABPB_${label}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  const r = (await db.insertInto('rooms').values({ name: `ABP ${label}`, code: `ABP-${label}-${uniq}`.slice(0, 20), building_id: b, created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow()).id;
  props.push(p); blds.push(b); rooms.push(r);
  return { p, r };
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'ABP', email: `abp-${uniq}@t.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('entity_id', 'in', rooms).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('id', 'in', rooms).execute();
  await db.deleteFrom('buildings').where('id', 'in', blds).execute();
  await db.deleteFrom('properties').where('id', 'in', props).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('activity feed with a busy neighbour', () => {
  it('stamps each audit row with its property when it is written', async () => {
    const quiet = await unit('Q');
    await db.insertInto('audit_logs').values({ user_id: null, action: 'UPDATE', entity: 'rooms', entity_id: quiet.r, diff: null }).execute();
    const row = await db.selectFrom('audit_logs').select(['property_id', 'scope_kind']).where('entity_id', '=', quiet.r).executeTakeFirstOrThrow();
    expect(row).toEqual({ property_id: quiet.p, scope_kind: 'P' });
  });

  it('still shows a quiet property’s changes under 9,000 newer ones from another property', async () => {
    const quiet = await unit('Q2');
    const busy = await unit('B');
    await db.insertInto('audit_logs').values({
      user_id: null, action: 'UPDATE', entity: 'rooms', entity_id: quiet.r, diff: null,
      // Dated in the distant past (both sets) so they never crowd another test's "recent" rows —
      // test files share this database and run in parallel.
      created_at: sql`now() - interval '10 years'`,
    } as never).execute();
    await sql`
      INSERT INTO audit_logs (user_id, action, entity, entity_id, created_at)
      SELECT NULL, 'UPDATE', 'rooms', ${busy.r}, now() - interval '10 years' + interval '1 hour' + (g || ' ms')::interval
        FROM generate_series(1, 9000) g`.execute(db);

    const t = performance.now();
    const rows = await new ActivityRepository(db).recent(30, quiet.p, { userId, allProperties: false });
    const ms = performance.now() - t;
    expect(rows.map((r) => r.entity_id)).toContain(quiet.r);
    expect(rows.some((r) => r.entity_id === busy.r)).toBe(false);
    expect(ms).toBeLessThan(1000); // generous for CI; ~10 ms locally
    // The 5 s default timed out on CI (5009 / 5013 ms) while the FEED stayed well inside its own
    // 1 s check: the time goes on seeding 9,000 audit rows through the property-stamping trigger
    // on a shared, busy runner. The test's budget covers that setup; the speed guarantee is the
    // `ms` assertion above, which is unchanged.
  }, 30_000);
});
