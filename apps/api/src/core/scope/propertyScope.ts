import type { Kysely } from 'kysely';
import type { NextFunction, Request, Response } from 'express';
import { db as defaultDb } from '../../config/db.js';
import type { Database } from '../../db/types.js';
import { AppError } from '../errors/AppError.js';

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

/**
 * (R4 owner decision 2a, 2026-10-04) Gate for estate-wide settings.
 *
 * Some records belong to no property — rate plans are the first: one STANDARD rate is
 * charged at every block. Holding the permission is not enough to change one, because a
 * manager limited to one property would be setting prices for properties they are not
 * allowed into. Only an admin, or someone who is a member of every active property,
 * passes. Goes after `authorize(...)`, so the permission is checked first.
 */
export function requireAllProperties(message: string, dbInstance: Kysely<Database> = defaultDb) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const scope = await propertyScopeForUser(req.user!.sub, req.user!.role, dbInstance);
      if (!scope.allProperties) throw AppError.forbidden(message);
      next();
    } catch (err) {
      next(err);
    }
  };
}
