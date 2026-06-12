import { Kysely, sql } from 'kysely';
import type {
  Database,
  PropertyRow,
  NewProperty,
  UpdateProperty,
  BuildingRow,
  NewBuilding,
  UpdateBuilding,
} from '../../db/types.js';
import type { PropertyRequestMeta } from './properties.types.js';

export class PropertiesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listProperties(): Promise<PropertyRow[]> {
    return this.db.selectFrom('properties').selectAll().orderBy('name', 'asc').execute();
  }

  async listBuildings(): Promise<BuildingRow[]> {
    return this.db.selectFrom('buildings').selectAll().orderBy('name', 'asc').execute();
  }

  /** Active-unit count per building id. */
  async unitCountsByBuilding(): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom('rooms')
      .select(['building_id'])
      .select(this.db.fn.count<number>('id').as('count'))
      .where('deleted_at', 'is', null)
      .where('building_id', 'is not', null)
      .groupBy('building_id')
      .execute();
    const map = new Map<string, number>();
    for (const r of rows) if (r.building_id) map.set(r.building_id, Number(r.count));
    return map;
  }

  async findPropertyById(id: string): Promise<PropertyRow | undefined> {
    return this.db.selectFrom('properties').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async findBuildingById(id: string): Promise<BuildingRow | undefined> {
    return this.db.selectFrom('buildings').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async createProperty(property: NewProperty, meta: PropertyRequestMeta): Promise<PropertyRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('properties')
        .values(property)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'properties',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();
      return inserted;
    });
  }

  async updateProperty(id: string, update: UpdateProperty, meta: PropertyRequestMeta): Promise<PropertyRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('properties')
        .set({ ...update, updated_at: sql`now()` })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'properties',
          entity_id: id,
          diff: update,
          ip_address: meta.ip ?? null,
        }).execute();
      }
      return updated;
    });
  }

  async createBuilding(building: NewBuilding, meta: PropertyRequestMeta): Promise<BuildingRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('buildings')
        .values(building)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'buildings',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();
      return inserted;
    });
  }

  async updateBuilding(id: string, update: UpdateBuilding, meta: PropertyRequestMeta): Promise<BuildingRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('buildings')
        .set({ ...update, updated_at: sql`now()` })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'buildings',
          entity_id: id,
          diff: update,
          ip_address: meta.ip ?? null,
        }).execute();
      }
      return updated;
    });
  }
}
