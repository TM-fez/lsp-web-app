import { api } from './client';
import { idempotencyConfig, wasReplayed } from './idempotency';
import type { Contact, ContactType, Paginated } from '@/types';

export interface CreateGuestInput {
  type: ContactType;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  address?: string | null;
  notes?: string | null;
  /** "Save anyway" after the server said another guest uses this email (R5). */
  allow_duplicate_email?: boolean;
}

export type UpdateGuestInput = Partial<CreateGuestInput>;

export interface GuestListParams {
  search?: string;
  type?: ContactType;
  /** 'stays' ranks by history carried over from the old booking system. Sorted in SQL, so it
   *  ranks the whole directory rather than the 100 rows this page happens to hold. */
  sort?: 'stays';
}

/** Server caps page size at 100; we fetch one page and surface the total so the
 *  UI can prompt the user to refine when results are truncated. */
export const GUEST_LIST_LIMIT = 100;

export async function listGuests(
  params?: GuestListParams,
  page = 1,
): Promise<Paginated<Contact>> {
  const { data } = await api.get<Paginated<Contact>>('/contacts', {
    params: { limit: GUEST_LIST_LIMIT, page, ...params },
  });
  return data;
}

/** `replayed` — the server answered from an earlier identical request; nothing new was saved. */
export async function createGuest(
  input: CreateGuestInput,
  idempotencyKey?: string
): Promise<Contact & { replayed: boolean }> {
  const res = await api.post<Contact>('/contacts', input, idempotencyConfig(idempotencyKey));
  return { ...res.data, replayed: wasReplayed(res.headers) };
}

export async function updateGuest(id: string, input: UpdateGuestInput): Promise<Contact> {
  const { data } = await api.patch<Contact>(`/contacts/${id}`, input);
  return data;
}

export async function deleteGuest(id: string): Promise<void> {
  await api.delete(`/contacts/${id}`);
}
