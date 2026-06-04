import { z } from 'zod';
import type { RequestMeta } from '../auth/auth.types';

export const ContactTypeEnum = z.enum(['individual', 'company']);

export const CreateContactSchema = z.object({
  type: ContactTypeEnum,
  name: z.string().min(1).max(255),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  company: z.string().max(255).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  notes: z.string().nullable().optional(),
  avatar_file_id: z.string().uuid().nullable().optional(),
});

export const UpdateContactSchema = CreateContactSchema.partial();

export type CreateContactDTO = z.infer<typeof CreateContactSchema>;
export type UpdateContactDTO = z.infer<typeof UpdateContactSchema>;

export interface ContactFilters {
  search?: string;
  type?: 'individual' | 'company';
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CRMRequestMeta extends RequestMeta {
  userId: string;
}
