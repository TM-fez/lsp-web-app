import { api } from './client';
import type { Invoice, InvoiceStatus, InvoiceKind, InvoiceDocument, InvoiceList } from '@/types';

export interface InvoiceListParams {
  status?: InvoiceStatus;
  kind?: InvoiceKind;
  /** Open receivables only (ISSUED + PARTIALLY_PAID, refunds excluded). */
  outstanding?: boolean;
  /** Open and past the due date. */
  overdue?: boolean;
  /** Invoice number, guest / bill-to name or unit. */
  search?: string;
  /** Issue-date range, YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export async function listInvoices(params: InvoiceListParams): Promise<InvoiceList> {
  const { data } = await api.get<InvoiceList>('/invoices', { params });
  return data;
}

export async function getInvoiceDocument(id: string): Promise<InvoiceDocument> {
  const { data } = await api.get<InvoiceDocument>(`/invoices/${id}/document`);
  return data;
}

export async function sendInvoice(id: string): Promise<{ sent: true; to: string }> {
  const { data } = await api.post<{ sent: true; to: string }>(`/invoices/${id}/send`, {});
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
