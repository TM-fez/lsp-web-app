import { Kysely, sql } from 'kysely';
import type { Database, FileRow, NewFile, UpdateFile } from '../../db/types.js';
import type { FileRequestMeta, PaginatedResult } from './files.types.js';

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
        } as any)
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
