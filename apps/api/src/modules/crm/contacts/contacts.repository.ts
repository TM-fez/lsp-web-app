import { assertCanDelete } from '../../../core/integrity/liveBookings.js';
import { Kysely, sql } from 'kysely';
import type { Database, ContactRow, NewContact, UpdateContact } from '../../../db/types.js';
import type { ContactFilters, ContactViewer, PaginationOptions, PaginatedResult, CRMRequestMeta } from '../crm.types.js';
import { contactVisibleSql } from '../../../core/scope/contactScope.js';

export class ContactsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** `viewer` limits to the guests that person may see; internal callers omit it. */
  async findById(id: string, viewer?: ContactViewer): Promise<ContactRow | undefined> {
    let q = this.db
      .selectFrom('contacts')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null);
    if (viewer) q = q.where(contactVisibleSql('contacts', viewer.propertyIds, viewer.userId));
    return q.executeTakeFirst();
  }

  async findPaginated(
    filters: ContactFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<ContactRow>> {
    let query = this.db
      .selectFrom('contacts')
      .selectAll()
      .where('deleted_at', 'is', null);

    let countQuery = this.db
      .selectFrom('contacts')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null);

    if (filters.visibleTo) {
      const visible = contactVisibleSql('contacts', filters.visibleTo.propertyIds, filters.visibleTo.userId);
      query = query.where(visible);
      countQuery = countQuery.where(visible);
    }

    if (filters.type) {
      query = query.where('type', '=', filters.type);
      countQuery = countQuery.where('type', '=', filters.type);
    }

    if (filters.search) {
      const searchPattern = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('name', 'ilike', searchPattern),
          eb('email', 'ilike', searchPattern),
          eb('company', 'ilike', searchPattern),
        ])
      );
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('name', 'ilike', searchPattern),
          eb('email', 'ilike', searchPattern),
          eb('company', 'ilike', searchPattern),
        ])
      );
    }

    const offset = (pagination.page - 1) * pagination.limit;
    
    const [data, [{ total }]] = await Promise.all([
      (filters.sort === 'stays'
        ? query.orderBy('previous_stays', 'desc').orderBy('name', 'asc')
        : query.orderBy('created_at', 'desc')
      )
        .limit(pagination.limit)
        .offset(offset)
        .execute(),
      countQuery.execute(),
    ]);

    return {
      data,
      total: Number(total),
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  /** Does another live contact already use this email (case-insensitive)? */
  async emailInUse(email: string, excludeId?: string): Promise<boolean> {
    let q = this.db
      .selectFrom('contacts')
      .select('id')
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`lower(email) = lower(${email})`);
    if (excludeId) q = q.where('id', '!=', excludeId);
    return !!(await q.executeTakeFirst());
  }

  async create(contact: NewContact, meta: CRMRequestMeta): Promise<ContactRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('contacts')
        .values(contact)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'contacts',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();

      return inserted;
    });
  }

  async update(id: string, update: UpdateContact, meta: CRMRequestMeta): Promise<ContactRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('contacts')
        .set({ ...update, updated_at: sql`now()` })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'contacts',
          entity_id: id,
          diff: update,
          ip_address: meta.ip ?? null,
        }).execute();
      }

      return updated;
    });
  }

  async softDelete(id: string, meta: CRMRequestMeta): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      // (Round 4) Refuse — 409, in plain English — while live bookings or unpaid invoices
      // still name this guest; see core/integrity/liveBookings.ts. false = already gone.
      if (!(await assertCanDelete(trx, { kind: 'contact', id }))) return false;
      const deleted = await trx
        .updateTable('contacts')
        .set({ 
          deleted_at: sql`now()`,
          deleted_by: meta.userId
        })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (deleted) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'DELETE',
          entity: 'contacts',
          entity_id: id,
          diff: { deleted_at: deleted.deleted_at, deleted_by: deleted.deleted_by },
          ip_address: meta.ip ?? null,
        }).execute();
        return true;
      }

      return false;
    });
  }
}
