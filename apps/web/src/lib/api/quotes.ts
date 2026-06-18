import { api } from './client';
import type { Quote, Paginated } from '@/types';

export async function listQuotes(params: { status?: string; limit?: number }): Promise<Paginated<Quote>> {
  const { data } = await api.get<Paginated<Quote>>('/quotes', { params });
  return data;
}
