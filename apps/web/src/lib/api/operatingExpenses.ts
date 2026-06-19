import { api } from './client';
import type { OperatingExpense, OperatingExpenseCategory, RecurringCost } from '@/types';

export interface OpexListParams {
  property_id?: string;
  category?: OperatingExpenseCategory;
  from?: string;
  to?: string;
}

export interface OpexInput {
  property_id?: string | null;
  category: OperatingExpenseCategory;
  description: string;
  vendor?: string | null;
  amount: number;          // thebe
  incurred_on: string;     // YYYY-MM-DD
  notes?: string | null;
  receipt_file_id?: string | null;
}

export async function listOperatingExpenses(params: OpexListParams): Promise<OperatingExpense[]> {
  const { data } = await api.get<{ data: OperatingExpense[] }>('/operating-expenses', { params });
  return data.data;
}

export async function createOperatingExpense(input: OpexInput): Promise<OperatingExpense> {
  const { data } = await api.post<OperatingExpense>('/operating-expenses', input);
  return data;
}

export async function updateOperatingExpense(id: string, input: Partial<OpexInput>): Promise<OperatingExpense> {
  const { data } = await api.patch<OperatingExpense>(`/operating-expenses/${id}`, input);
  return data;
}

export async function deleteOperatingExpense(id: string): Promise<void> {
  await api.delete(`/operating-expenses/${id}`);
}

// ── Recurring templates ─────────────────────────────────────────────────────
export interface RecurringInput {
  property_id?: string | null;
  category: OperatingExpenseCategory;
  description: string;
  vendor?: string | null;
  amount: number;            // thebe
  day_of_month?: number;
  active?: boolean;
  notes?: string | null;
}

export async function listRecurring(): Promise<RecurringCost[]> {
  const { data } = await api.get<{ data: RecurringCost[] }>('/operating-expenses/recurring');
  return data.data;
}
export async function createRecurring(input: RecurringInput): Promise<RecurringCost> {
  const { data } = await api.post<RecurringCost>('/operating-expenses/recurring', input);
  return data;
}
export async function updateRecurring(id: string, input: Partial<RecurringInput>): Promise<RecurringCost> {
  const { data } = await api.patch<RecurringCost>(`/operating-expenses/recurring/${id}`, input);
  return data;
}
export async function deleteRecurring(id: string): Promise<void> {
  await api.delete(`/operating-expenses/recurring/${id}`);
}
export async function generateRecurring(month?: string): Promise<{ month: string; created: number; skipped: number; templates: number }> {
  const { data } = await api.post('/operating-expenses/recurring/generate', month ? { month } : {});
  return data;
}
