import { z } from 'zod';

export const StorageDriverEnum = z.enum(['local', 's3']);
export type StorageDriver = z.infer<typeof StorageDriverEnum>;

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const UploadFileSchema = z.object({
  // usually parsed from multipart form data metadata rather than body
  is_public: z.coerce.boolean().default(false),
});

export const FileQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// (P6) The Files library.
export const LibraryQuerySchema = z.object({
  category: z
    .enum(['GUEST_DOCUMENTS', 'INCOME_RECEIPTS', 'EXPENSE_RECEIPTS', 'REPAIR_PHOTOS', 'UNIT_PHOTOS',
      'PROFILE_PICTURES', 'CONTRACTS', 'COMPLIANCE', 'OTHER', 'UNFILED'])
    .optional(),
  property_id: z.string().uuid().optional(),
  uploaded_by: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type LibraryQueryDTO = z.infer<typeof LibraryQuerySchema>;

/** Only a standalone upload can be filed by hand; linked files take their record's category. */
export const ClassifyFileSchema = z.object({
  category: z.enum(['CONTRACTS', 'COMPLIANCE', 'OTHER']).nullable(),
  property_id: z.string().uuid().nullable().default(null),
});
export type ClassifyFileDTO = z.infer<typeof ClassifyFileSchema>;

export const DeleteFileSchema = z.object({
  id: z.string().uuid(),
});

export type UploadFileDTO = z.infer<typeof UploadFileSchema>;
export type FileQueryDTO = z.infer<typeof FileQuerySchema>;

export interface FileRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
