export type ContactType = 'individual' | 'company';

export interface Contact {
  id: string;
  type: ContactType;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  notes: string | null;
  avatarFileId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

export interface CreateContactRequest {
  type: ContactType;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  notes?: string;
}

export interface UpdateContactRequest extends Partial<CreateContactRequest> {}

export interface ContactListResponse {
  data: Contact[];
  total: number;
  page: number;
  pageSize: number;
}
