/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, item 9) The web's route-guard test (apps/web/src/router/routeGuards.test.tsx) works
 * from a snapshot of each role's permissions. This keeps that snapshot honest: if a migration
 * grants or removes a permission, this fails until the snapshot — and so the guard
 * expectations — are reviewed.
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../../src/config/db.js';

describe('web role-permission snapshot', () => {
  it('matches role_permissions in the database for every built-in role', async () => {
    const mod = await import('../../../../web/src/test/rolePermissions.js' as string);
    const snapshot = mod.ROLE_PERMISSIONS as Record<string, string[]>;

    const rows = await db
      .selectFrom('roles as r')
      .innerJoin('role_permissions as rp', 'rp.role_id', 'r.id')
      .innerJoin('permissions as p', 'p.id', 'rp.permission_id')
      .select(['r.name as role', 'p.name as perm'])
      .execute();
    const actual: Record<string, string[]> = {};
    for (const r of rows) (actual[r.role] ??= []).push(r.perm);
    for (const k of Object.keys(actual)) actual[k]!.sort();

    const sorted = Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, [...v].sort()]));
    expect(sorted).toEqual(actual);
  });
});
