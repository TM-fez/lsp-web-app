import { Kysely, PostgresDialect } from 'kysely';
import pkg from 'pg';
import { env } from './env.js';
import type { Database } from '../db/types.js';

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  min: env.DATABASE_POOL_MIN,
  max: env.DATABASE_POOL_MAX,
  // (R7 N7-1) Fail a request that can't get a connection instead of hanging it forever.
  connectionTimeoutMillis: env.DATABASE_POOL_ACQUIRE_TIMEOUT_MS,
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

export async function checkDbConnection(): Promise<void> {
  const client = await pool.connect();
  client.release();
}
