import { api } from './client';
import type { OwnersResponse } from '@/types';

export interface OwnersParams {
  from?: string;        // YYYY-MM-DD
  to?: string;          // YYYY-MM-DD
  property_id?: string;
}

/** Per third-party-landlord payout statements for a date window. */
export async function getOwners(params: OwnersParams): Promise<OwnersResponse> {
  const { data } = await api.get<OwnersResponse>('/reports/owners', { params });
  return data;
}
