/**
 * (Round 4) The demo seed marked some stays CHECKED_IN but never created their occupancy rows
 * (nor marked the unit occupied), so the in-house screens and check-out disagreed with the
 * reservation list. Every CHECKED_IN demo stay now has exactly one open occupancy row.
 *
 * Builds a throw-away database (migrate + base seed + demo seed), so no shared test data is
 * touched. Skips itself when the database user may not create databases.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import pkg from 'pg';

const { Client } = pkg;
const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const scratch = `lsp_demoseed_${uniq}`;
const base = new URL(process.env['DATABASE_URL'] ?? 'postgresql://lsp:lsp@localhost:5432/lsp_test');
const admin = new URL(base); admin.pathname = '/postgres';
const scratchUrl = new URL(base); scratchUrl.pathname = `/${scratch}`;
let canCreate = false;
let rows: Array<{ reservation_id: string; status: string; occupancy_rows: number; room_status: string }> = [];

const run = (script: string, ...args: string[]) =>
  execFileSync('node', ['--import', 'tsx', script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: scratchUrl.toString(), NODE_ENV: 'test', ALLOW_NONLOCAL_SEED: '1' },
    stdio: 'pipe',
    timeout: 150_000,
  });

beforeAll(async () => {
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    await c.query(`CREATE DATABASE ${scratch}`);
    canCreate = true;
  } catch {
    canCreate = false;
  } finally {
    await c.end();
  }
  if (!canCreate) return;
  run('src/db/migrate.ts');
  run('src/db/seed.ts');
  run('src/db/seed-demo.ts');
  const s = new Client({ connectionString: scratchUrl.toString() });
  await s.connect();
  rows = (await s.query(
    `SELECT r.id AS reservation_id, r.status, rm.status AS room_status,
            (SELECT count(*)::int FROM occupancy o WHERE o.reservation_id = r.id AND o.deleted_at IS NULL AND o.status = 'CHECKED_IN') AS occupancy_rows
       FROM reservations r JOIN rooms rm ON rm.id = r.room_id
      WHERE r.status = 'CHECKED_IN' AND r.notes LIKE 'DEMO%'`,
  )).rows;
  await s.end();
}, 240_000);

afterAll(async () => {
  if (!canCreate) return;
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await c.end();
}, 30_000);

describe('demo seed in-house stays', () => {
  it('gives every CHECKED_IN demo reservation exactly one open occupancy row and an occupied unit', (ctx) => {
    if (!canCreate) return ctx.skip();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.occupancy_rows !== 1)).toEqual([]);
    expect(rows.filter((r) => r.room_status !== 'OCCUPIED')).toEqual([]);
  });
});
