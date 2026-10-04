import { Kysely, sql } from 'kysely';
import type { AppSettingsRow, Database } from '../../db/types.js';
import type { SettingsRequestMeta, UpdateSettingsDTO } from './settings.types.js';

export class SettingsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async get(): Promise<AppSettingsRow> {
    // The row is created by migration 074; recreate it if someone ever deleted it.
    await this.db.insertInto('app_settings').values({ id: 1 } as never).onConflict((oc) => oc.column('id').doNothing()).execute();
    return this.db.selectFrom('app_settings').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
  }

  /** Apply the fields that were sent, and audit exactly what changed, in one transaction. */
  async update(dto: UpdateSettingsDTO, meta: SettingsRequestMeta): Promise<AppSettingsRow> {
    const changes = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    await this.get();
    return this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('app_settings').selectAll().where('id', '=', 1).forUpdate().executeTakeFirstOrThrow();
      const after = await trx
        .updateTable('app_settings')
        .set({ ...changes, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', 1)
        .returningAll()
        .executeTakeFirstOrThrow();
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of Object.keys(changes) as (keyof AppSettingsRow)[]) {
        if (before[k] !== after[k]) diff[k] = { from: before[k], to: after[k] };
      }
      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'UPDATE',
        entity: 'app_settings',
        entity_id: '1',
        diff,
        ip_address: meta.ip ?? null,
      }).execute();
      return after;
    });
  }
}
