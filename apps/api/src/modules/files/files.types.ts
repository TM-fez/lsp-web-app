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
