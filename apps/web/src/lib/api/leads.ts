import { api } from './client';
import type { Lead, LeadStatus, LeadSource, Paginated, Reservation } from '@/types';

export interface LeadListParams {
  search?: string;
  status?: LeadStatus;
  source?: LeadSource;
}

// CONVERTED is system-owned (a future convert-to-booking flow), never set here.
export type SettableLeadStatus = Exclude<LeadStatus, 'CONVERTED'>;

export interface CreateLeadInput {
  title: string;
  description?: string | null;
  status?: SettableLeadStatus;
  source?: LeadSource | null;
  phone?: string | null;
}

export type UpdateLeadInput = Partial<CreateLeadInput>;

export const LEAD_LIST_LIMIT = 100;

export async function listLeads(params?: LeadListParams): Promise<Paginated<Lead>> {
  const { data } = await api.get<Paginated<Lead>>('/leads', {
    params: { limit: LEAD_LIST_LIMIT, ...params },
  });
  return data;
}

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  const { data } = await api.post<Lead>('/leads', input);
  return data;
}

export async function updateLead(id: string, input: UpdateLeadInput): Promise<Lead> {
  const { data } = await api.patch<Lead>(`/leads/${id}`, input);
  return data;
}

export async function deleteLead(id: string): Promise<void> {
  await api.delete(`/leads/${id}`);
}

// Convert an enquiry into a (PENDING) booking. The guest is the lead's linked
// contact unless contact_id is provided here.
export interface ConvertLeadInput {
  contact_id?: string;
  room_id: string;
  check_in_date: string; // YYYY-MM-DD
  check_out_date: string;
  notes?: string | null;
}

export async function convertLead(id: string, input: ConvertLeadInput): Promise<{ reservation: Reservation; lead: Lead }> {
  const { data } = await api.post<{ reservation: Reservation; lead: Lead }>(`/leads/${id}/convert`, input);
  return data;
}
