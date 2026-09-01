import { api } from './client';
import type { Paginated, PaymentIntent, PaymentAttempt, PaymentStatus } from '@/types';

export interface PaymentListParams {
  status?: PaymentStatus;
  hold_id?: string;
  page?: number;
  limit?: number;
}

export async function listPayments(params: PaymentListParams = {}): Promise<Paginated<PaymentIntent>> {
  const { data } = await api.get<Paginated<PaymentIntent>>('/payments', {
    params: { limit: 100, ...params },
  });
  return data;
}

// The detail carries every attempt in order — which is where "why did this fail" lives.
export async function getPayment(id: string): Promise<PaymentIntent & { attempts_log: PaymentAttempt[] }> {
  const { data } = await api.get<PaymentIntent & { attempts_log: PaymentAttempt[] }>(`/payments/${id}`);
  return data;
}
