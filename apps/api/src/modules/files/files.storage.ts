import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { env } from '../../config/env.js';
import type { FileRow } from '../../db/types.js';

/**
 * Storage backends for the files module.
 *
 * `local` writes under STORAGE_LOCAL_PATH — fine on a laptop, but on Render the disk
 * is EPHEMERAL: every deploy/restart wipes it. `s3` talks to any S3-compatible bucket
 * (Cloudflare R2 / Backblaze B2 / AWS) via STORAGE_S3_*, which is the production
 * driver. Both serve downloads through the API (`getUrl` is the same app-relative
 * route), so switching drivers changes nothing for clients.
 */

export interface StorageAdapter {
  /** Which driver this is — recorded on each files row. */
  readonly name: 'local' | 's3';
  /** Bucket the binary lives in (null for local disk). */
  readonly bucket: string | null;
  /** sizeBytes is required by S3-compatible stores (no chunked PUT without it). */
  save(inputStream: NodeJS.ReadableStream, destinationPath: string, sizeBytes?: number): Promise<void>;
  delete(destinationPath: string): Promise<void>;
  /** Whether the binary actually exists — dedupe must check this, not just the DB row. */
  exists(destinationPath: string): Promise<boolean>;
  getUrl(file: FileRow): string;
  getStream(destinationPath: string): Promise<NodeJS.ReadableStream>;
}

export class LocalStorageDriver implements StorageAdapter {
  readonly name = 'local' as const;
  readonly bucket = null;

  constructor(private readonly baseDir: string) {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  async save(inputStream: NodeJS.ReadableStream, destinationPath: string): Promise<void> {
    const fullPath = path.join(this.baseDir, destinationPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const writeStream = fs.createWriteStream(fullPath);
    await pipeline(inputStream, writeStream);
  }

  async delete(destinationPath: string): Promise<void> {
    const fullPath = path.join(this.baseDir, destinationPath);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }

  async exists(destinationPath: string): Promise<boolean> {
    try {
      await fs.promises.access(path.join(this.baseDir, destinationPath), fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  getUrl(file: FileRow): string {
    return `/api/files/${file.id}/download`;
  }

  async getStream(destinationPath: string): Promise<NodeJS.ReadableStream> {
    const fullPath = path.join(this.baseDir, destinationPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error('File not found on disk');
    }
    return fs.createReadStream(fullPath);
  }
}

export interface S3Config {
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  /** R2/B2 need an explicit endpoint; leave unset for AWS proper. */
  endpoint?: string;
}

export class S3StorageDriver implements StorageAdapter {
  readonly name = 's3' as const;
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(cfg: S3Config, client?: S3Client) {
    this.bucket = cfg.bucket;
    this.client =
      client ??
      new S3Client({
        region: cfg.region,
        credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
        ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
      });
  }

  async save(inputStream: NodeJS.ReadableStream, destinationPath: string, sizeBytes?: number): Promise<void> {
    if (sizeBytes === undefined) {
      // S3-compatible PUTs need the length up front; the service stats the temp file.
      throw new Error('S3 storage requires the byte size of the upload');
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: destinationPath,
        Body: inputStream as Readable,
        ContentLength: sizeBytes,
      }),
    );
  }

  async delete(destinationPath: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: destinationPath }));
  }

  async exists(destinationPath: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: destinationPath }));
      return true;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  getUrl(file: FileRow): string {
    // Downloads stream through the API in both drivers — the bucket stays private.
    return `/api/files/${file.id}/download`;
  }

  async getStream(destinationPath: string): Promise<NodeJS.ReadableStream> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: destinationPath }),
    );
    if (!res.Body) throw new Error('File not found in bucket');
    return res.Body as Readable;
  }
}

/** The adapter the app runs with, per STORAGE_DRIVER. Fails fast on incomplete s3 config. */
export function createStorageAdapter(): StorageAdapter {
  if (env.STORAGE_DRIVER === 's3') {
    const { STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY } = env;
    if (!STORAGE_S3_BUCKET || !STORAGE_S3_REGION || !STORAGE_S3_ACCESS_KEY || !STORAGE_S3_SECRET_KEY) {
      throw new Error(
        'STORAGE_DRIVER=s3 needs STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY and STORAGE_S3_SECRET_KEY',
      );
    }
    return new S3StorageDriver({
      bucket: STORAGE_S3_BUCKET,
      region: STORAGE_S3_REGION,
      accessKey: STORAGE_S3_ACCESS_KEY,
      secretKey: STORAGE_S3_SECRET_KEY,
      endpoint: env.STORAGE_S3_ENDPOINT || undefined,
    });
  }
  return new LocalStorageDriver(env.STORAGE_LOCAL_PATH);
}
