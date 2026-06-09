import { api } from './client';
import type { Paginated, Reservation, ReservationStatus } from '@/types';

export interface ReservationListParams {
  search?: string;
  status?: ReservationStatus;
  room_id?: string;
  contact_id?: string;
}

export interface CreateReservationInput {
  contact_id: string;
  room_id: string;
  check_in_date: string; // YYYY-MM-DD
  check_out_date: string; // YYYY-MM-DD
  notes?: string | null;
}

export type UpdateReservationInput = Partial<CreateReservationInput>;

export const RESERVATION_LIST_LIMIT = 100;

export async function listReservations(params?: ReservationListParams): Promise<Paginated<Reservation>> {
  const { data } = await api.get<Paginated<Reservation>>('/reservations', {
    params: { limit: RESERVATION_LIST_LIMIT, ...params },
  });
  return data;
}

// Status is intentionally never sent: the server forces PENDING on create, and a
// reservation only becomes CONFIRMED through payment (settlePaid).
export async function createReservation(input: CreateReservationInput): Promise<Reservation> {
  const { data } = await api.post<Reservation>('/reservations', input);
  return data;
}

export async function updateReservation(id: string, input: UpdateReservationInput): Promise<Reservation> {
  const { data } = await api.patch<Reservation>(`/reservations/${id}`, input);
  return data;
}

// DELETE = cancel (sets status CANCELLED); the server rejects this for
// CHECKED_IN / CHECKED_OUT / already-CANCELLED reservations.
export async function cancelReservation(id: string): Promise<Reservation> {
  const { data } = await api.delete<Reservation>(`/reservations/${id}`);
  return data;
}

export async function checkAvailability(params: {
  room_id: string;
  check_in_date: string;
  check_out_date: string;
}): Promise<boolean> {
  const { data } = await api.get<{ available: boolean }>('/reservations/availability', { params });
  return data.available;
}
