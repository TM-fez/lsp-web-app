import { api } from './client';
import type { Expense, ExpenseStatus } from '@/types';

export async function listExpenses(status?: ExpenseStatus): Promise<Expense[]> {
  const { data } = await api.get<{ data: Expense[] }>('/expenses', {
    params: status ? { status } : undefined,
  });
  return data.data;
}

export async function approveExpense(id: string): Promise<void> {
  await api.post(`/expenses/${id}/approve`, {});
}

export async function reconcileExpense(id: string): Promise<void> {
  await api.post(`/expenses/${id}/reconcile`, {});
}
