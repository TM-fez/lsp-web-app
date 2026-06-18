import { api } from './client';
import type { OperatingExpense, OperatingExpenseCategory } from '@/types';

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
