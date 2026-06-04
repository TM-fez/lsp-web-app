import type { Request, Response } from 'express';
import { checkDbConnection, pool } from '../../config/db.js';
import { env } from '../../config/env.js';
import fs from 'fs/promises';
import path from 'path';

export async function liveness(_req: Request, res: Response): Promise<void> {
  res.json({ status: 'ok', uptime: process.uptime() });
}

export async function readiness(_req: Request, res: Response): Promise<void> {
  try {
    await checkDbConnection();

    // Check migrations table exists (postgres-migrations creates this)
    const client = await pool.connect();
    let migrations: 'current' | 'error' = 'current';
    try {
      await client.query('SELECT 1 FROM migrations LIMIT 1');
    } catch {
      migrations = 'error';
    } finally {
      client.release();
    }

    res.json({ status: 'ok', db: 'connected', migrations });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db: 'error',
      migrations: 'error',
      detail: String(err),
    });
  }
}

export async function storageHealth(_req: Request, res: Response): Promise<void> {
  const driver = env.STORAGE_DRIVER;
  const start = Date.now();

  if (driver === 'local') {
    try {
      const dir = path.resolve(process.cwd(), env.STORAGE_LOCAL_PATH);
      const probe = path.join(dir, '.health-probe');
      await fs.writeFile(probe, 'ok');
      await fs.unlink(probe);
      res.json({ status: 'ok', driver, latencyMs: Date.now() - start });
    } catch (err) {
      res.status(503).json({
        status: 'error',
        driver,
        latencyMs: Date.now() - start,
        detail: String(err),
      });
    }
    return;
  }

  // S3 path — HeadBucket probe (wired when S3 is configured)
  res.status(503).json({
    status: 'error',
    driver,
    latencyMs: Date.now() - start,
    detail: 'S3 storage health check not yet configured',
  });
}
