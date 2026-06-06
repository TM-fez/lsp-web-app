import { api } from './client';
import type {
  Contact,
  Room,
  Reservation,
  Quote,
  Hold,
  PaymentIntent,
  Paginated,
  UnitType,
  PaymentMethod,
} from '@/types';

export async function searchContacts(search: string): Promise<Contact[]> {
  const { data } = await api.get<Paginated<Contact>>('/contacts', { params: { search, limit: 10 } });
  return data.data;
}

export async function createContact(input: { name: string; email?: string; phone?: string }): Promise<Contact> {
  const { data } = await api.post<Contact>('/contacts', { type: 'individual', ...input });
  return data;
}

export async function listAvailableRooms(): Promise<Room[]> {
  const { data } = await api.get<{ data: Room[] }>('/rooms/available');
  return data.data;
}

export async function createReservation(input: {
  contact_id: string;
  room_id: string;
  check_in_date: string;
  check_out_date: string;
}): Promise<Reservation> {
  const { data } = await api.post<Reservation>('/reservations', { ...input, status: 'PENDING' });
  return data;
}

export async function createQuote(input: {
  unit_type: UnitType;
  check_in: string;
  check_out: string;
  guests: number;
}): Promise<Quote> {
  const { data } = await api.post<Quote>('/quotes', input);
  return data;
}

export async function createHold(input: {
  quote_id: string;
  room_id: string;
  reservation_id: string;
}): Promise<Hold> {
  const { data } = await api.post<Hold>('/holds', input);
  return data;
}

export async function createPaymentIntent(input: {
  hold_id: string;
  method: PaymentMethod;
  purpose?: 'DEPOSIT' | 'BALANCE';
}): Promise<PaymentIntent> {
  const { data } = await api.post<PaymentIntent>('/payments', { purpose: 'DEPOSIT', ...input });
  return data;
}

export async function attemptPayment(intentId: string, outcome: 'SUCCESS' | 'FAILURE'): Promise<PaymentIntent> {
  const { data } = await api.post<PaymentIntent>(`/payments/${intentId}/attempt`, { outcome });
  return data;
}
