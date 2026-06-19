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
