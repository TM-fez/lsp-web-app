export type StorageDriver = 'local' | 's3';

export interface FileRecord {
  id: string;
  uploadedBy: string;
  driver: StorageDriver;
  bucket: string | null;
  key: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface UploadResponse {
  file: FileRecord;
}
