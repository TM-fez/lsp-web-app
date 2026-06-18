import { api } from './client';
import type { Invoice, InvoiceStatus, InvoiceKind, Paginated } from '@/types';

export interface InvoiceListParams {
  status?: InvoiceStatus;
  kind?: InvoiceKind;
  page?: number;
  limit?: number;
}

export async function listInvoices(params: InvoiceListParams): Promise<Paginated<Invoice>> {
  const { data } = await api.get<Paginated<Invoice>>('/invoices', { params });
  return data;
}

export async function issueInvoice(quote_id: string, kind: 'DEPOSIT' | 'BALANCE'): Promise<Invoice> {
  const { data } = await api.post<Invoice>('/invoices', { quote_id, kind });
  return data;
}

export async function settleInvoice(id: string, receipt_file_id?: string | null): Promise<Invoice> {
  const { data } = await api.post<Invoice>(`/invoices/${id}/settle`, { receipt_file_id: receipt_file_id ?? null });
  return data;
}

export async function refundInvoice(id: string, amount: number, reason: string): Promise<Invoice> {
  const { data } = await api.post<Invoice>(`/invoices/${id}/refund`, { amount, reason });
  return data;
}
