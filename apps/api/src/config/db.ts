import { Kysely, PostgresDialect } from 'kysely';
import pkg from 'pg';
import { env } from './env.js';
import type { Database } from '../db/types.js';

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  min: env.DATABASE_POOL_MIN,
  max: env.DATABASE_POOL_MAX,
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

export async function checkDbConnection(): Promise<void> {
  const client = await pool.connect();
  client.release();
}
