import { api } from './client';
import type { Paginated, RatePlan, UnitType } from '@/types';

export interface RatePlanInput {
  unit_type: UnitType;
  name: string;
  nightly_rate: number; // thebe
  weekly_rate: number; // thebe
  monthly_rate: number; // thebe
  min_nights: number;
  max_guests: number;
  deposit_pct: number;
  tax_rate_bps: number;
  currency: string;
  active: boolean;
}

function unwrap(data: unknown): RatePlan[] {
  if (Array.isArray(data)) return data as RatePlan[];
  return ((data as Paginated<RatePlan>)?.data ?? []) as RatePlan[];
}

export async function listRatePlans(params?: { unit_type?: UnitType; active?: boolean }): Promise<RatePlan[]> {
  const { data } = await api.get('/pricing', { params: { limit: 200, ...params } });
  return unwrap(data);
}

export async function createRatePlan(input: RatePlanInput): Promise<RatePlan> {
  const { data } = await api.post<RatePlan>('/pricing', input);
  return data;
}

export async function updateRatePlan(id: string, input: Partial<RatePlanInput>): Promise<RatePlan> {
  const { data } = await api.patch<RatePlan>(`/pricing/${id}`, input);
  return data;
}

export async function deleteRatePlan(id: string): Promise<void> {
  await api.delete(`/pricing/${id}`);
}
