import { z } from 'zod';
import type { CRMRequestMeta, PaginatedResult, PaginationOptions } from '../crm.types.js';

export const LeadStatusEnum = z.enum([
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'CONVERTED',
  'LOST',
]);

export const UserInputLeadStatusEnum = z.enum([
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'LOST',
]);

// Enquiry channel — mirrors the discovery report's sources.
export const LeadSourceEnum = z.enum([
  'WHATSAPP',
  'WALK_IN',
  'BOOKING_COM',
  'WEBSITE',
  'REFERRAL',
  'CORPORATE',
  'OTHER',
]);

export const CreateLeadSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  status: UserInputLeadStatusEnum.default('NEW'),
  contact_id: z.string().uuid().nullable().optional(), // CRM contacts link optional
  source: LeadSourceEnum.nullable().optional(),
});

export const UpdateLeadSchema = CreateLeadSchema.partial();

export type CreateLeadDTO = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadDTO = z.infer<typeof UpdateLeadSchema>;

export interface LeadFilters {
  search?: string;
  status?: z.infer<typeof LeadStatusEnum>;
  source?: z.infer<typeof LeadSourceEnum>;
}

export type { CRMRequestMeta as LeadRequestMeta, PaginatedResult as PaginatedLeadResult, PaginationOptions as LeadPaginationOptions };
