import { api } from './client';
import type { EmployeePay, PayrollSummary, PayFrequency } from '@/types';

export interface CompensationInput {
  job_title?: string | null;
  gross_amount: number;            // thebe
  frequency: PayFrequency;
  payment_method?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  start_date?: string | null;
  active?: boolean;
  notes?: string | null;
}

export async function listEmployees(): Promise<EmployeePay[]> {
  const { data } = await api.get<{ data: EmployeePay[] }>('/payroll/employees');
  return data.data;
}

export async function getPayrollSummary(): Promise<PayrollSummary> {
  const { data } = await api.get<PayrollSummary>('/payroll/summary');
  return data;
}

export async function upsertCompensation(userId: string, input: CompensationInput): Promise<void> {
  await api.put(`/payroll/employees/${userId}`, input);
}

export async function postPayrollToCosts(month?: string): Promise<{ month: string; amount: number }> {
  const { data } = await api.post('/payroll/post-to-costs', month ? { month } : {});
  return data;
}
