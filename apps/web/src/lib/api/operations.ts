import { api } from './client';
import type { OperationsResponse } from '@/types';

export interface OperationsParams {
  months?: number;      // trailing completed months (default 12)
  property_id?: string;
}

/** P4.3 — occupancy trend + year-over-year comparison across the estate. */
export async function getOperations(params: OperationsParams = {}): Promise<OperationsResponse> {
  const { data } = await api.get<OperationsResponse>('/reports/operations', { params });
  return data;
}
