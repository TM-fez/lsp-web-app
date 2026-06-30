import { z } from 'zod';

export const OperatingExpenseCategoryEnum = z.enum([
  'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'INSURANCE', 'SUPPLIES', 'SOFTWARE', 'OTHER',
]);
export type OperatingExpenseCategory = z.infer<typeof OperatingExpenseCategoryEnum>;

export const CreateOperatingExpenseSchema = z.object({
  property_id: z.string().uuid().nullable().optional(),
  category: OperatingExpenseCategoryEnum,
  description: z.string().min(1).max(300),
  vendor: z.string().max(200).nullable().optional(),
  amount: z.number().int().positive(),        // thebe (100 = 1 BWP)
  currency: z.string().length(3).optional(),
  incurred_on: z.coerce.date(),               // accepts 'YYYY-MM-DD', stored as DATE
  notes: z.string().max(2000).nullable().optional(),
  receipt_file_id: z.string().uuid().nullable().optional(),
});

export const UpdateOperatingExpenseSchema = CreateOperatingExpenseSchema.partial();

export type CreateOperatingExpenseDTO = z.infer<typeof CreateOperatingExpenseSchema>;
export type UpdateOperatingExpenseDTO = z.infer<typeof UpdateOperatingExpenseSchema>;

export interface OperatingExpenseFilters {
  property_id?: string;
  category?: OperatingExpenseCategory;
  from?: string; // YYYY-MM-DD (incurred_on >=)
  to?: string;   // YYYY-MM-DD (incurred_on <=)
  // Access scope: null/undefined = no restriction (admin); array = the caller's
  // properties ([] = none).
  accessiblePropertyIds?: string[] | null;
}

export interface OperatingExpensesRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}

// ── Recurring templates ───────────────────────────────────────────────────────
export const CreateRecurringSchema = z.object({
  property_id: z.string().uuid().nullable().optional(),
  category: OperatingExpenseCategoryEnum,
  description: z.string().min(1).max(300),
  vendor: z.string().max(200).nullable().optional(),
  amount: z.number().int().positive(),
  day_of_month: z.number().int().min(1).max(28).optional(),
  active: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export const UpdateRecurringSchema = CreateRecurringSchema.partial();
export const GenerateRecurringSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM').optional(),
});
export type CreateRecurringDTO = z.infer<typeof CreateRecurringSchema>;
export type UpdateRecurringDTO = z.infer<typeof UpdateRecurringSchema>;
