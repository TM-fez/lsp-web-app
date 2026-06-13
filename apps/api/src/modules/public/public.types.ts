import { z } from 'zod';
import { UnitTypeEnum } from '../pricing/pricing.types.js';

// A public, guest-facing booking request. No auth — this is the front door onto
// the same booking engine staff use, so it is deliberately narrow and validated.
export const CreateBookingSchema = z
  .object({
    unit_type: UnitTypeEnum,
    check_in: z.coerce.date(),
    check_out: z.coerce.date(),
    guests: z.coerce.number().int().min(1).max(20).default(1),
    name: z.string().min(1).max(200),
    email: z.string().email().max(200),
    phone: z.string().min(3).max(40),
  })
  .refine((d) => d.check_in < d.check_out, {
    message: 'check_out must be after check_in',
    path: ['check_out'],
  });

export type CreateBookingDTO = z.infer<typeof CreateBookingSchema>;

export interface PublicRequestMeta {
  ip?: string;
  requestId?: string;
}

/** One bookable layout shown on the public site (no PII, prices only). */
export interface StayUnitOption {
  unit_type: string;
  name: string;
  nightly_rate: number; // thebe
  deposit_pct: number;
  max_guests: number;
  min_nights: number;
  currency: string;
}
