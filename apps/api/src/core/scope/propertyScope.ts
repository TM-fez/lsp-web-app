import type { Kysely } from 'kysely';
import { db as defaultDb } from '../../config/db.js';
import type { Database } from '../../db/types.js';

/**
 * (Round 4) One definition of "how much of the estate can this person see".
 *
 * - `ids`            — the property ids the person works in; `null` means admin (no filter).
 * - `allProperties`  — true when they can see EVERY active property: an admin, or someone
 *                      with a membership in each active property. Only these people see
 *                      data that belongs to no property (company-level costs, payroll for
 *                      staff with no membership, unfiled files, unassigned leads, the whole
 *                      audit feed). Someone limited to some properties never does — that
 *                      data may belong to a property they are not allowed into.
 *
 * Membership in "every property" is deliberately judged against the properties that are
 * active right now: if a third property opens tomorrow, a two-property accountant becomes
 * a limited user until an admin adds the new membership. That is the safe direction.
 */
export interface PropertyScope {
  ids: string[] | null;
  allProperties: boolean;
}

/** Pure decision, kept separate from the query so the rule itself is unit-tested. */
export function computePropertyScope(
  role: string | undefined,
  memberIds: string[],
  activePropertyIds: string[]
): PropertyScope {
  if (role === 'admin') return { ids: null, allProperties: true };
  const mine = new Set(memberIds);
  const coversEvery = activePropertyIds.length > 0 && activePropertyIds.every((id) => mine.has(id));
  return { ids: memberIds, allProperties: coversEvery };
}

export async function propertyScopeForUser(
  userId: string,
  role: string | undefined,
  dbInstance: Kysely<Database> = defaultDb
): Promise<PropertyScope> {
  if (role === 'admin') return { ids: null, allProperties: true };
  const [members, active] = await Promise.all([
    dbInstance.selectFrom('user_properties').select('property_id').where('user_id', '=', userId).execute(),
    dbInstance.selectFrom('properties').select('id').where('active', '=', true).execute(),
  ]);
  return computePropertyScope(
    role,
    members.map((m) => m.property_id),
    active.map((p) => p.id)
  );
}
