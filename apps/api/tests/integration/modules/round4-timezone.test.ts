/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, N-12 / R3 L-4) The API's JSON used to depend on the TZ of the process: a stay
 * starting 2028-02-16 came out as "2028-02-15T22:00:00.000Z" when the server ran in
 * Africa/Gaborone and "2028-02-16T00:00:00.000Z" in UTC. The server now pins itself to UTC
 * at start-up (all business-day logic uses the property-timezone helpers, never the
 * process zone), so the same data is always sent the same way.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const helper = path.resolve(__dirname, '../helpers/tz-probe.ts');
const apiDir = path.resolve(__dirname, '../../..');

function runUnder(tz: string) {
  const out = execFileSync(process.execPath, ['--import', 'tsx', helper], {
    cwd: apiDir,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop()!) as { read: string; written: string };
}

describe('date-only columns do not depend on the process timezone', () => {
  const zones = ['UTC', 'Africa/Gaborone', 'Pacific/Auckland', 'America/Los_Angeles'];

  it.each(zones)('reads a DATE as midnight UTC under TZ=%s', (tz) => {
    expect(runUnder(tz).read).toBe('2028-02-16T00:00:00.000Z');
  });

  it.each(zones)('stores the same calendar day it was given under TZ=%s', (tz) => {
    expect(runUnder(tz).written).toBe('2028-02-16');
  });
});
