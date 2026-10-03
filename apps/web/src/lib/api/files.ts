import { api } from './client';

export interface UploadedFile {
  id: string;
  original_name: string;
  mime_type: string;
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<UploadedFile>('/files/upload', form);
  return data;
}

/** The download endpoint is auth-gated, so fetch with the token and open the blob. */
export async function openFile(id: string): Promise<void> {
  const res = await api.get(`/files/${id}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── (P6) The Files library ────────────────────────────────────────────────────

export type LibraryCategory =
  | 'GUEST_DOCUMENTS'
  | 'INCOME_RECEIPTS'
  | 'EXPENSE_RECEIPTS'
  | 'REPAIR_PHOTOS'
  | 'UNIT_PHOTOS'
  | 'PROFILE_PICTURES'
  | 'CONTRACTS'
  | 'COMPLIANCE'
  | 'OTHER'
  | 'UNFILED';

/** The categories a person can file a standalone upload under. */
export type FilingCategory = 'CONTRACTS' | 'COMPLIANCE' | 'OTHER';

export interface LibraryFile {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  created_by: string;
  uploaded_by_name: string | null;
  category: LibraryCategory;
  link_kind: 'reservation' | 'invoice' | 'operating_expense' | 'work_order' | 'room' | 'user' | 'contact' | null;
  link_id: string | null;
  link_label: string | null;
  property_id: string | null;
  property_name: string | null;
}

export interface LibraryParams {
  category?: LibraryCategory;
  property_id?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface LibraryPage {
  data: LibraryFile[];
  total: number;
  page: number;
  limit: number;
}

export async function listLibrary(params: LibraryParams): Promise<LibraryPage> {
  const { data } = await api.get<LibraryPage>('/files/library', { params });
  return data;
}

export interface ClassifyFileInput {
  category: FilingCategory;
  property_id: string | null;
}

export async function classifyFile(id: string, input: ClassifyFileInput): Promise<void> {
  await api.patch(`/files/${id}/classify`, input);
}

export async function deleteFile(id: string): Promise<void> {
  await api.delete(`/files/${id}`);
}
