import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Database } from '../../db/types.js';

/**
 * (P6) The Files library: every live file, categorised by what it is ATTACHED TO.
 *
 * A file's category is derived, at read time, from the record that points at it — so it can
 * never disagree with where the file is actually used. Only documents uploaded straight into
 * the library (which belong to no record) carry a stored category (migration 073).
 *
 * Precedence when one file is linked twice (the upload dedupe can share bytes, not rows, so
 * this is rare): guest documents first — the most sensitive classification must win, or a
 * passport copy could surface under a category everyone can read.
 */

export const LIBRARY_CATEGORIES = [
  'GUEST_DOCUMENTS',
  'INCOME_RECEIPTS',
  'EXPENSE_RECEIPTS',
  'REPAIR_PHOTOS',
  'UNIT_PHOTOS',
  'PROFILE_PICTURES',
  'CONTRACTS',
  'COMPLIANCE',
  'OTHER',
  'UNFILED',
] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export interface LibraryRow {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: Date;
  created_by: string;
  uploaded_by_name: string | null;
  category: LibraryCategory;
  link_kind: 'reservation' | 'invoice' | 'operating_expense' | 'work_order' | 'room' | 'user' | 'contact' | null;
  link_id: string | null;
  link_label: string | null;
  property_id: string | null;
  property_name: string | null;
}

export interface LibraryFilters {
  category?: LibraryCategory;
  propertyId?: string;
  uploadedBy?: string;
  /** Gaborone calendar days, inclusive. */
  from?: string;
  to?: string;
  search?: string;
  page: number;
  limit: number;
}

export interface LibraryViewer {
  userId: string;
  /** May see guest ID / passport copies (files.guest_documents.read). */
  canSeeGuestDocuments: boolean;
  /** Contractors see only their own uploads and the photos on their own work orders. */
  isContractor: boolean;
  /** Holds files.delete (admin / operations): sees everyone's unfiled uploads, to file them. */
  canManageFiles: boolean;
  /** null = every property (admin); otherwise the properties this user belongs to. */
  accessiblePropertyIds: string[] | null;
}

/**
 * One row per (file, linked record). `prio` orders the categories when a file has several
 * links; `room_id` / `property_id` locate it; `assignee` lets a contractor see their own
 * repair photos.
 */
const LINKS = sql`
  SELECT r.document_file_id AS fid, 1 AS prio, 'GUEST_DOCUMENTS' AS category, 'reservation' AS kind,
         r.id AS link_id, COALESCE(c.name, 'Booking') AS label, r.room_id, NULL::uuid AS property_id, NULL::uuid AS assignee
    FROM reservations r LEFT JOIN contacts c ON c.id = r.contact_id
   WHERE r.document_file_id IS NOT NULL
  UNION ALL
  SELECT o.document_file_id, 1, 'GUEST_DOCUMENTS', 'reservation', o.reservation_id,
         COALESCE(c.name, 'Check-in'), o.room_id, NULL, NULL
    FROM occupancy o
    LEFT JOIN reservations r ON r.id = o.reservation_id
    LEFT JOIN contacts c ON c.id = r.contact_id
   WHERE o.document_file_id IS NOT NULL
  UNION ALL
  SELECT i.receipt_file_id, 2, 'INCOME_RECEIPTS', 'invoice', i.id, i.number, rsv.room_id, NULL, NULL
    FROM invoices i LEFT JOIN reservations rsv ON rsv.id = i.reservation_id
   WHERE i.receipt_file_id IS NOT NULL
  UNION ALL
  SELECT e.receipt_file_id, 3, 'EXPENSE_RECEIPTS', 'operating_expense', e.id, e.description, NULL, e.property_id, NULL
    FROM operating_expenses e
   WHERE e.receipt_file_id IS NOT NULL
  UNION ALL
  SELECT w.before_file_id, 4, 'REPAIR_PHOTOS', 'work_order', w.id, w.title, w.room_id, NULL, w.assigned_to
    FROM maintenance_work_orders w WHERE w.before_file_id IS NOT NULL
  UNION ALL
  SELECT w.after_file_id, 4, 'REPAIR_PHOTOS', 'work_order', w.id, w.title, w.room_id, NULL, w.assigned_to
    FROM maintenance_work_orders w WHERE w.after_file_id IS NOT NULL
  UNION ALL
  SELECT rm.image_file_id, 5, 'UNIT_PHOTOS', 'room', rm.id, rm.code, rm.id, NULL, NULL
    FROM rooms rm WHERE rm.image_file_id IS NOT NULL
  UNION ALL
  SELECT u.avatar_file_id, 6, 'PROFILE_PICTURES', 'user', u.id, u.name, NULL, NULL, NULL
    FROM users u WHERE u.avatar_file_id IS NOT NULL
  UNION ALL
  SELECT ct.avatar_file_id, 6, 'PROFILE_PICTURES', 'contact', ct.id, ct.name, NULL, NULL, NULL
    FROM contacts ct WHERE ct.avatar_file_id IS NOT NULL
`;

/** The categorised library as a derived table `lib`, before viewer and filter rules. */
function libraryBase(): RawBuilder<unknown> {
  // The links are gathered ONCE and the best (lowest prio) kept per file, then joined —
  // not a per-file subquery, which would rescan every linking table for every file.
  return sql`
    SELECT f.id, f.original_name, f.mime_type, f.size_bytes, f.created_at, f.created_by,
           u.name AS uploaded_by_name,
           COALESCE(l.category, f.category, 'UNFILED') AS category,
           l.kind AS link_kind, l.link_id, l.label AS link_label, l.assignee,
           COALESCE(b.property_id, l.property_id, f.property_id) AS property_id
      FROM files f
      LEFT JOIN users u ON u.id = f.created_by
      LEFT JOIN (
        SELECT DISTINCT ON (links.fid) * FROM (${LINKS}) links ORDER BY links.fid, links.prio
      ) l ON l.fid = f.id
      LEFT JOIN rooms lr ON lr.id = l.room_id
      LEFT JOIN buildings b ON b.id = lr.building_id
     WHERE f.deleted_at IS NULL
  `;
}

/** Viewer rules every library read applies — the list AND the single-file guard. */
function viewerWhere(v: LibraryViewer): RawBuilder<unknown> {
  const parts: RawBuilder<unknown>[] = [sql`true`];
  if (!v.canSeeGuestDocuments) parts.push(sql`lib.category <> 'GUEST_DOCUMENTS'`);
  // (Re-test 2026-10-04) An UNFILED upload is attached to nothing and filed under nothing —
  // often a document someone uploaded and has not classified yet. It used to be visible to
  // everyone with files.read. Until it is filed, it belongs to whoever uploaded it, plus
  // the people who manage files (files.delete) so a stray upload can still be tidied.
  if (!v.canManageFiles) parts.push(sql`(lib.category <> 'UNFILED' OR lib.created_by = ${v.userId})`);
  if (v.isContractor) {
    parts.push(sql`(lib.created_by = ${v.userId} OR (lib.category = 'REPAIR_PHOTOS' AND lib.assignee = ${v.userId}))`);
  }
  if (v.accessiblePropertyIds !== null) {
    // A file about no property (a profile picture, an unfiled upload) is house-wide.
    parts.push(
      v.accessiblePropertyIds.length === 0
        ? sql`lib.property_id IS NULL`
        : sql`(lib.property_id IS NULL OR lib.property_id IN (${sql.join(v.accessiblePropertyIds)}))`
    );
  }
  return sql.join(parts, sql` AND `);
}

export async function listLibrary(
  db: Kysely<Database>,
  viewer: LibraryViewer,
  f: LibraryFilters
): Promise<{ data: LibraryRow[]; total: number; page: number; limit: number }> {
  const parts: RawBuilder<unknown>[] = [viewerWhere(viewer)];
  if (f.category) parts.push(sql`lib.category = ${f.category}`);
  if (f.propertyId) parts.push(sql`lib.property_id = ${f.propertyId}`);
  if (f.uploadedBy) parts.push(sql`lib.created_by = ${f.uploadedBy}`);
  if (f.from) parts.push(sql`(lib.created_at AT TIME ZONE 'Africa/Gaborone')::date >= ${f.from}::date`);
  if (f.to) parts.push(sql`(lib.created_at AT TIME ZONE 'Africa/Gaborone')::date <= ${f.to}::date`);
  if (f.search) {
    const like = `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(sql`(lib.original_name ILIKE ${like} OR lib.link_label ILIKE ${like})`);
  }
  const where = sql.join(parts, sql` AND `);

  const rows = await sql<LibraryRow & { total: string }>`
    SELECT lib.id, lib.original_name, lib.mime_type, lib.size_bytes, lib.created_at, lib.created_by,
           lib.uploaded_by_name, lib.category, lib.link_kind, lib.link_id, lib.link_label,
           lib.property_id, p.name AS property_name,
           COUNT(*) OVER () AS total
      FROM (${libraryBase()}) lib
      LEFT JOIN properties p ON p.id = lib.property_id
     WHERE ${where}
     ORDER BY lib.created_at DESC, lib.id
     LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}
  `.execute(db);

  const total = rows.rows[0] ? Number(rows.rows[0].total) : 0;
  const data = rows.rows.map(({ total: _t, ...r }) => ({ ...r, size_bytes: Number(r.size_bytes) }));
  return { data, total, page: f.page, limit: f.limit };
}

/** May this viewer open this one file? Same rules as the list — a hidden row is a 404. */
export async function viewerCanOpen(db: Kysely<Database>, viewer: LibraryViewer, fileId: string): Promise<boolean> {
  const r = await sql<{ id: string }>`
    SELECT lib.id FROM (${libraryBase()}) lib WHERE lib.id = ${fileId} AND ${viewerWhere(viewer)}
  `.execute(db);
  return r.rows.length > 0;
}

/** Is the file linked to any record? Linked files take their category from the link. */
export async function isLinked(db: Kysely<Database>, fileId: string): Promise<boolean> {
  const r = await sql<{ n: number }>`SELECT 1 AS n FROM (${LINKS}) links WHERE links.fid = ${fileId} LIMIT 1`.execute(db);
  return r.rows.length > 0;
}
