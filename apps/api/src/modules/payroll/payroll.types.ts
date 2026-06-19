import { z } from 'zod';

export const PayFrequencyEnum = z.enum(['MONTHLY', 'WEEKLY']);
export type PayFrequency = z.infer<typeof PayFrequencyEnum>;

export const UpsertCompensationSchema = z.object({
  job_title: z.string().max(120).nullable().optional(),
  gross_amount: z.number().int().nonnegative(),       // thebe, per `frequency`
  frequency: PayFrequencyEnum.default('MONTHLY'),
  payment_method: z.string().max(40).nullable().optional(),
  bank_name: z.string().max(120).nullable().optional(),
  bank_account: z.string().max(60).nullable().optional(),
  start_date: z.coerce.date().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpsertCompensationDTO = z.infer<typeof UpsertCompensationSchema>;

export const PostPayrollSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM').optional(),
});
export type PostPayrollDTO = z.infer<typeof PostPayrollSchema>;

export interface PayrollRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}

/** One staff member with their (optional) compensation, as the Payroll view shows. */
export interface EmployeePay {
  user_id: string;
  name: string;
  role: string;
  is_lead: boolean;
  job_title: string | null;
  gross_amount: number | null;     // thebe
  frequency: PayFrequency | null;
  monthly_equivalent: number | null;
  payment_method: string | null;
  bank_name: string | null;
  bank_account: string | null;
  start_date: string | null;
  active: boolean;                 // compensation active (false when not set yet)
  notes: string | null;
}
