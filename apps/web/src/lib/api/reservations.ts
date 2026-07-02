import { api } from './client';
import type { Paginated, Reservation, ReservationStatus, ReservationSource } from '@/types';

export interface ReservationListParams {
  search?: string;
  status?: ReservationStatus;
  source?: ReservationSource;
  room_id?: string;
  contact_id?: string;
  property_id?: string;
}

export interface CreateReservationInput {
  contact_id: string;
  room_id: string;
  check_in_date: string; // YYYY-MM-DD
  check_out_date: string; // YYYY-MM-DD
  notes?: string | null;
  source?: ReservationSource;
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
// Tier 1 of the OTA contact-info plan: attach a real guest contact to an imported
// Booking.com block; the server promotes it to CONFIRMED (check-in-able, invoiceable).
export async function claimOtaBooking(id: string, contactId: string): Promise<Reservation> {
  const { data } = await api.post<Reservation>(`/reservations/${id}/claim`, { contact_id: contactId });
  return data;
}

export async function cancelReservation(id: string): Promise<Reservation> {
  const { data } = await api.delete<Reservation>(`/reservations/${id}`);
  return data;
}

// Permanently remove a CANCELLED booking from the lists (server soft-deletes it:
// the row is kept for audit but hidden everywhere). Rejected for any other status.
export async function removeReservation(id: string): Promise<void> {
  await api.delete(`/reservations/${id}/remove`);
}

export interface SetDiscountInput {
  discount_type: 'PERCENT' | 'FIXED';
  discount_value: number; // percent points, or thebe for FIXED
  discount_reason?: string | null;
}

export async function setDiscount(id: string, input: SetDiscountInput): Promise<Reservation> {
  const { data } = await api.post<Reservation>(`/reservations/${id}/discount`, input);
  return data;
}

export async function approveDiscount(id: string): Promise<Reservation> {
  const { data } = await api.post<Reservation>(`/reservations/${id}/discount/approve`, {});
  return data;
}

export async function removeDiscount(id: string): Promise<Reservation> {
  const { data } = await api.delete<Reservation>(`/reservations/${id}/discount`);
  return data;
}

export interface ReservationPricing {
  priceable: true;
  currency: string;
  nights: number;
  base_amount: number;
  discount: {
    type: 'PERCENT' | 'FIXED';
    value: number;
    reason: string | null;
    approved: boolean;
    amount: number; // thebe actually applied (0 until approved)
  } | null;
  subtotal: number;
  tax_rate_bps: number;
  tax_amount: number;
  total_amount: number;
  deposit_pct: number;
  deposit_amount: number;
}

export interface ReservationNotPriceable {
  priceable: false;
  reason: string;
  nights: number;
}

export async function getReservationPricing(
  id: string,
): Promise<ReservationPricing | ReservationNotPriceable> {
  const { data } = await api.get<ReservationPricing | ReservationNotPriceable>(
    `/reservations/${id}/pricing`,
  );
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
