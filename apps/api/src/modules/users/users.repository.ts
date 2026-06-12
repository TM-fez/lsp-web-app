import type { Kysely } from 'kysely';
import type { Database, UserRow } from '../../db/types.js';
import type { RoleInfo, StaffUser, UsersRequestMeta } from './users.types.js';

type UserWithRole = Omit<UserRow, 'password_hash' | 'avatar_file_id' | 'role_id'> & {
  role: string;
};

function toStaffUser(row: UserWithRole, extras: string[]): StaffUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as StaffUser['role'],
    active: row.active,
    is_lead: row.is_lead,
    extra_permissions: extras,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class UsersRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private selectUserWithRole() {
    return this.db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .select([
        'users.id',
        'users.name',
        'users.email',
        'users.active',
        'users.is_lead',
        'users.created_at',
        'users.updated_at',
        'roles.name as role',
      ]);
  }

  /** All extra grants for a set of users, grouped by user id. */
  private async extrasFor(userIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (userIds.length === 0) return map;
    const rows = await this.db
      .selectFrom('user_permissions')
      .innerJoin('permissions', 'permissions.id', 'user_permissions.permission_id')
      .select(['user_permissions.user_id', 'permissions.name'])
      .where('user_permissions.user_id', 'in', userIds)
      .execute();
    for (const r of rows) {
      const list = map.get(r.user_id) ?? [];
      list.push(r.name);
      map.set(r.user_id, list);
    }
    return map;
  }

  async listAll(): Promise<StaffUser[]> {
    const rows = await this.selectUserWithRole().orderBy('users.created_at', 'asc').execute();
    const extras = await this.extrasFor(rows.map((r) => r.id));
    return rows.map((r) => toStaffUser(r, extras.get(r.id) ?? []));
  }

  /** Minimal active-staff directory for pickers (assign-to etc.) — names + roles only. */
  async listDirectory(): Promise<{ id: string; name: string; role: string; is_lead: boolean }[]> {
    return this.db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .select(['users.id', 'users.name', 'roles.name as role', 'users.is_lead'])
      .where('users.active', '=', true)
      .orderBy('users.name', 'asc')
      .execute();
  }

  async findById(id: string): Promise<StaffUser | null> {
    const row = await this.selectUserWithRole().where('users.id', '=', id).executeTakeFirst();
    if (!row) return null;
    const extras = await this.extrasFor([row.id]);
    return toStaffUser(row, extras.get(row.id) ?? []);
  }

  async emailExists(email: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst();
    return !!row;
  }

  async findRoleByName(name: string): Promise<{ id: number; name: string } | null> {
    const row = await this.db
      .selectFrom('roles')
      .select(['id', 'name'])
      .where('name', '=', name)
      .executeTakeFirst();
    return row ?? null;
  }

  async listRoles(): Promise<RoleInfo[]> {
    const roles = await this.db.selectFrom('roles').select(['id', 'name']).orderBy('id').execute();
    const perms = await this.db
      .selectFrom('role_permissions')
      .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
      .select(['role_permissions.role_id', 'permissions.name'])
      .execute();
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.name),
    }));
  }

  /** Resolve permission names → ids; returns found rows so the service can spot unknowns. */
  async findPermissionsByNames(names: string[]): Promise<{ id: number; name: string }[]> {
    if (names.length === 0) return [];
    return this.db
      .selectFrom('permissions')
      .select(['id', 'name'])
      .where('name', 'in', names)
      .execute();
  }

  /** Active admins other than the given user — guards the last-admin invariant. */
  async countOtherActiveAdmins(excludeUserId: string): Promise<number> {
    const row = await this.db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('roles.name', '=', 'admin')
      .where('users.active', '=', true)
      .where('users.id', '!=', excludeUserId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async create(
    input: {
      name: string;
      email: string;
      password_hash: string;
      role_id: number;
      is_lead: boolean;
    },
    extraPermissionIds: number[],
    meta: UsersRequestMeta
  ): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const user = await trx
        .insertInto('users')
        .values({
          name: input.name,
          email: input.email,
          password_hash: input.password_hash,
          role_id: input.role_id,
          is_lead: input.is_lead,
          avatar_file_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (extraPermissionIds.length > 0) {
        await trx
          .insertInto('user_permissions')
          .values(extraPermissionIds.map((permission_id) => ({ user_id: user.id, permission_id })))
          .execute();
      }

      await trx
        .insertInto('audit_logs')
        .values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'CREATE',
          entity: 'user',
          entity_id: user.id,
          diff: JSON.stringify({ name: input.name, email: input.email, role_id: input.role_id, is_lead: input.is_lead }),
          ip_address: meta.ip ?? null,
        })
        .execute();

      return user.id;
    });
  }

  async update(
    id: string,
    fields: { name?: string; role_id?: number; active?: boolean; is_lead?: boolean },
    extraPermissionIds: number[] | undefined,
    meta: UsersRequestMeta
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      if (Object.values(fields).some((v) => v !== undefined)) {
        await trx
          .updateTable('users')
          .set({ ...fields, updated_at: new Date() })
          .where('id', '=', id)
          .execute();
      }

      // Replace-all semantics: the drawer always sends the full extras set.
      if (extraPermissionIds !== undefined) {
        await trx.deleteFrom('user_permissions').where('user_id', '=', id).execute();
        if (extraPermissionIds.length > 0) {
          await trx
            .insertInto('user_permissions')
            .values(extraPermissionIds.map((permission_id) => ({ user_id: id, permission_id })))
            .execute();
        }
      }

      await trx
        .insertInto('audit_logs')
        .values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'user',
          entity_id: id,
          diff: JSON.stringify({ ...fields, extra_permission_ids: extraPermissionIds }),
          ip_address: meta.ip ?? null,
        })
        .execute();
    });
  }

  /** New password + kill every live session so old logins stop working at once. */
  async resetPassword(id: string, passwordHash: string, meta: UsersRequestMeta): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({ password_hash: passwordHash, updated_at: new Date() })
        .where('id', '=', id)
        .execute();

      await trx
        .updateTable('refresh_tokens')
        .set({ revoked: true })
        .where('user_id', '=', id)
        .where('revoked', '=', false)
        .execute();

      await trx
        .insertInto('audit_logs')
        .values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'user_password',
          entity_id: id,
          diff: JSON.stringify({ password_reset: true }),
          ip_address: meta.ip ?? null,
        })
        .execute();
    });
  }
}
