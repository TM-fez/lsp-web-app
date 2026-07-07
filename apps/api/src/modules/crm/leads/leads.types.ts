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
  phone: z.string().max(50).nullable().optional(), // enquirer's number (WhatsApp follow-up)
});

export const UpdateLeadSchema = CreateLeadSchema.partial();

// Convert an enquiry into a booking. The guest is the lead's linked contact unless
// one is picked here; the reservation is created PENDING (the commercial invariant),
// and its source is derived from the lead's channel.
export const ConvertLeadSchema = z
  .object({
    contact_id: z.string().uuid().optional(),
    room_id: z.string().uuid(),
    check_in_date: z.coerce.date(),
    check_out_date: z.coerce.date(),
    notes: z.string().nullable().optional(),
  })
  .refine((d) => d.check_in_date < d.check_out_date, {
    message: 'check_out_date must be after check_in_date',
    path: ['check_out_date'],
  });

export type CreateLeadDTO = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadDTO = z.infer<typeof UpdateLeadSchema>;
export type ConvertLeadDTO = z.infer<typeof ConvertLeadSchema>;

export interface LeadFilters {
  search?: string;
  status?: z.infer<typeof LeadStatusEnum>;
  source?: z.infer<typeof LeadSourceEnum>;
}

export type { CRMRequestMeta as LeadRequestMeta, PaginatedResult as PaginatedLeadResult, PaginationOptions as LeadPaginationOptions };
