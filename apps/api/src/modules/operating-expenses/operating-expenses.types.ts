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
});

export const UpdateOperatingExpenseSchema = CreateOperatingExpenseSchema.partial();

export type CreateOperatingExpenseDTO = z.infer<typeof CreateOperatingExpenseSchema>;
export type UpdateOperatingExpenseDTO = z.infer<typeof UpdateOperatingExpenseSchema>;

export interface OperatingExpenseFilters {
  property_id?: string;
  category?: OperatingExpenseCategory;
  from?: string; // YYYY-MM-DD (incurred_on >=)
  to?: string;   // YYYY-MM-DD (incurred_on <=)
}

export interface OperatingExpensesRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}
