import { Kysely, sql } from 'kysely';
import type { Database, FileRow, NewFile } from '../../db/types.js';
import type { FileRequestMeta, PaginatedResult } from './files.types.js';
import { isLinked, listLibrary, viewerCanOpen, type LibraryFilters, type LibraryViewer } from './files.library.js';

type NewFileRecord = Omit<NewFile, 'id' | 'created_at' | 'updated_at'>;

export class FilesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(fileData: NewFileRecord, meta: FileRequestMeta): Promise<FileRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('files')
        .values({
          ...fileData,
          created_by: meta.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'files',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();

      return inserted;
    });
  }

  /** (P6) The categorised library, filtered and scoped to the viewer. */
  library(viewer: LibraryViewer, filters: LibraryFilters) {
    return listLibrary(this.db, viewer, filters);
  }

  /**
   * (H6/P6) May this viewer open this file? The library's own rules: contractors see only
   * their uploads and their work orders' photos, guest ID copies need
   * files.guest_documents.read, and a file about another property is out of scope.
   */
  canOpen(viewer: LibraryViewer, fileId: string): Promise<boolean> {
    return viewerCanOpen(this.db, viewer, fileId);
  }

  isLinked(fileId: string): Promise<boolean> {
    return isLinked(this.db, fileId);
  }

  /** File a standalone library upload under a category / property, audited. */
  async classify(
    id: string,
    data: { category: 'CONTRACTS' | 'COMPLIANCE' | 'OTHER' | null; property_id: string | null },
    meta: FileRequestMeta
  ): Promise<FileRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('files')
        .set({ category: data.category, property_id: data.property_id, updated_at: sql`now()` })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'files',
          entity_id: id,
          diff: data,
          ip_address: meta.ip ?? null,
        }).execute();
      }
      return updated;
    });
  }

  async findById(id: string): Promise<FileRow | undefined> {
    return this.db
      .selectFrom('files')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async findByChecksum(checksum: string): Promise<FileRow | undefined> {
    return this.db
      .selectFrom('files')
      .selectAll()
      .where('checksum', '=', checksum)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async findPaginated(
    page: number,
    limit: number,
    ownerId?: string
  ): Promise<PaginatedResult<FileRow>> {
    let query = this.db.selectFrom('files').selectAll().where('deleted_at', 'is', null);
    let countQuery = this.db.selectFrom('files').select(this.db.fn.count<number>('id').as('total')).where('deleted_at', 'is', null);

    if (ownerId) {
      query = query.where('created_by', '=', ownerId);
      countQuery = countQuery.where('created_by', '=', ownerId);
    }

    const offset = (page - 1) * limit;

    const [data, [{ total }]] = await Promise.all([
      query.limit(limit).offset(offset).orderBy('created_at', 'desc').execute(),
      countQuery.execute(),
    ]);

    return {
      data,
      total: Number(total),
      page,
      limit,
    };
  }

  async listByOwner(ownerId: string): Promise<FileRow[]> {
    return this.db
      .selectFrom('files')
      .selectAll()
      .where('created_by', '=', ownerId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async softDelete(id: string, meta: FileRequestMeta): Promise<FileRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('files')
        .set({
          deleted_at: sql`now()`,
          deleted_by: meta.userId,
          updated_at: sql`now()`,
        })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'DELETE',
          entity: 'files',
          entity_id: id,
          diff: { deleted_at: updated.deleted_at, deleted_by: updated.deleted_by },
          ip_address: meta.ip ?? null,
        }).execute();
      }

      return updated;
    });
  }

  // Future adapter hook - logic stays in service layer but repository can wrap URL fields if needed
  generateDownloadUrl(file: FileRow): string {
    return `/api/files/${file.id}/download`;
  }
}
