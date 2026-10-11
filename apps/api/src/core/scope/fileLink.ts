import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { propertyScopeForUser } from './propertyScope.js';

/**
 * (Audit 2026-10-11, L-10) May this user attach this file to a record?
 *
 * A file's library category and property come from the record that links it (files.library.ts),
 * so attaching a file is a way of moving it — onto your own receipt, your own work order, your
 * own guest's picture — where you can then open it. Writers only checked that the file existed,
 * so anyone who learned another file's id could pull it into reach. Now: your own upload, or
 * you work across every property (who could open it anyway). Callers answer "not found"/"invalid"
 * either way, so the check never confirms someone else's file exists.
 */
export async function fileLinkableBy(db: Kysely<Database>, fileId: string, userId: string): Promise<boolean> {
  const file = await db
    .selectFrom('files')
    .select('created_by')
    .where('id', '=', fileId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!file) return false;
  if (file.created_by === userId) return true;
  const user = await db
    .selectFrom('users as u')
    .innerJoin('roles as r', 'r.id', 'u.role_id')
    .select('r.name as role')
    .where('u.id', '=', userId)
    .executeTakeFirst();
  return (await propertyScopeForUser(userId, user?.role, db)).allProperties;
}
