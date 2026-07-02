import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError } from '../../core/errors/AppError.js';
import { FilesRepository } from './files.repository.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, type FileRequestMeta, type FileQueryDTO } from './files.types.js';
import type { StorageAdapter } from './files.storage.js';
import type { FileRow } from '../../db/types.js';

// Drivers + factory live in files.storage.ts; re-exported so existing imports keep working.
export { LocalStorageDriver, S3StorageDriver, createStorageAdapter, type StorageAdapter } from './files.storage.js';

export class FilesService {
  constructor(
    private readonly repository: FilesRepository,
    private readonly storageAdapter: StorageAdapter
  ) {}

  async upload(
    inputStream: NodeJS.ReadableStream,
    originalName: string,
    mimeType: string,
    sizeBytes: number,
    isPublic: boolean,
    meta: FileRequestMeta
  ): Promise<FileRow> {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw AppError.badRequest(`Disallowed MIME type: ${mimeType}`);
    }

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      throw AppError.badRequest(`File size exceeds limit of ${MAX_FILE_SIZE_BYTES} bytes`);
    }

    // Hash the stream while writing to a temporary file
    const hash = crypto.createHash('sha256');
    const ext = path.extname(originalName).replace('.', '') || 'bin';
    const tempFileName = `${crypto.randomUUID()}.tmp`;
    
    // Pipe to disk and hash simultaneously
    const tempPath = path.join(os.tmpdir(), tempFileName);
    const writeStream = fs.createWriteStream(tempPath);
    
    try {
      // Manual piping to calculate hash during stream
      await new Promise((resolve, reject) => {
        inputStream.on('data', (chunk) => hash.update(chunk));
        inputStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', () => resolve(undefined));
        inputStream.pipe(writeStream);
      });

      const checksum = hash.digest('hex');
      const { size: actualBytes } = await fs.promises.stat(tempPath);

      // Duplicate prevention (storage-only dedupe) — but the DB row alone doesn't
      // prove the binary survived (an ephemeral disk wipes on redeploy), so verify
      // the bytes actually exist before skipping the write.
      const existing = await this.repository.findByChecksum(checksum);
      let destinationPath = '';

      if (existing) {
        destinationPath = existing.path;
        if (!(await this.storageAdapter.exists(destinationPath))) {
          const readStream = fs.createReadStream(tempPath);
          await this.storageAdapter.save(readStream, destinationPath, actualBytes);
        }
      } else {
        const storedName = `${checksum}.${ext}`;
        destinationPath = `${new Date().getFullYear()}/${new Date().getMonth() + 1}/${storedName}`;

        // Move from temp to permanent storage via adapter
        const readStream = fs.createReadStream(tempPath);
        await this.storageAdapter.save(readStream, destinationPath, actualBytes);
      }

      return await this.repository.create({
        original_name: originalName,
        stored_name: existing ? existing.stored_name : `${checksum}.${ext}`,
        mime_type: mimeType,
        extension: ext,
        size_bytes: sizeBytes,
        checksum,
        // Where THIS upload verified/wrote the binary — the active driver, not
        // whatever the first-ever upload of these bytes used.
        storage_driver: this.storageAdapter.name,
        bucket: this.storageAdapter.bucket,
        path: destinationPath,
        is_public: isPublic,
        created_by: meta.userId,
      }, meta);
    } finally {
      // Safe async cleanup of temp file
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  }

  async getMetadata(id: string): Promise<FileRow> {
    const file = await this.repository.findById(id);
    if (!file) throw AppError.notFound(`File ${id} not found`);
    return file;
  }

  async getDownloadStream(id: string): Promise<{ stream: NodeJS.ReadableStream, file: FileRow }> {
    const file = await this.getMetadata(id);
    try {
      const stream = await this.storageAdapter.getStream(file.path);
      return { stream, file };
    } catch {
      // The row survived but the binary didn't (e.g. pre-S3 uploads lost to the
      // ephemeral disk) — a 404 the client can reason about, not a 500.
      throw AppError.notFound('File content is no longer available; please re-upload it');
    }
  }

  /** H5: uploaders see their own files; admins see everything. */
  async listFiles(query: FileQueryDTO, meta: FileRequestMeta, isAdmin: boolean) {
    return this.repository.findPaginated(query.page, query.limit, isAdmin ? undefined : meta.userId);
  }

  async delete(id: string, meta: FileRequestMeta): Promise<void> {
    const file = await this.repository.findById(id);
    if (!file) throw AppError.notFound(`File ${id} not found`);

    // Soft delete only, preserving the binary just in case, but adapter can optionally delete.
    // The prompt says "soft delete only", meaning we do NOT call storageAdapter.delete.
    await this.repository.softDelete(id, meta);
  }
}
