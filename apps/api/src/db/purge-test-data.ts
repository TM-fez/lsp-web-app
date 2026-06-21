/**
 * One-off cleanup: clear the data created while testing the app so the live
 * system starts from a clean slate. Covers the operator-flagged test data AND the
 * cockpit state a test stay leaves behind:
 *
 *   • reservations            (soft-delete)
 *   • contacts / guests       (soft-delete)
 *   • maintenance_work_orders (soft-delete — also clears the Finance "expenses",
 *                              which are just work orders that carry a cost)
 *   • operating_expenses      (soft-delete)
 *   • occupancy               (soft-delete the CHECKED_IN rows — the "in-house" list)
 *   • rooms                   (reset OCCUPIED → AVAILABLE so the cockpit reads 0%)
 *
 * Soft-deletes are reversible at the DB level and the room reset just flips a
 * status, so no foreign keys are touched and nothing else can break.
 *
 * Unlike seed-demo this is MEANT to run against the live database, so the guard is
 * the opposite: it does NOTHING unless you pass --yes. Without the flag it is a dry
 * run that only prints what it *would* clear.
 *
 * Usage (from repo root or apps/api, with DATABASE_URL pointing at the target DB):
 *   npx tsx apps/api/src/db/purge-test-data.ts          # dry run — just the counts
 *   npx tsx apps/api/src/db/purge-test-data.ts --yes     # actually clear them
 */
import 'dotenv/config';
import pkg from 'pg';

const { Client } = pkg;

interface Op {
  label: string;
  count: string; // counts what is still left to clear
  apply: string; // clears / resets it
}

// Order is cosmetic — soft-deletes don't touch foreign keys — but reservations and
// occupancy are listed before the room reset so the output reads top-down.
const OPS: Op[] = [
  {
    label: 'reservations',
    count: 'SELECT count(*)::int AS n FROM reservations WHERE deleted_at IS NULL',
    apply: 'UPDATE reservations SET deleted_at = now() WHERE deleted_at IS NULL',
  },
  {
    label: 'guests (contacts)',
    count: 'SELECT count(*)::int AS n FROM contacts WHERE deleted_at IS NULL',
    apply: 'UPDATE contacts SET deleted_at = now() WHERE deleted_at IS NULL',
  },
  {
    label: 'maintenance work orders',
    count: 'SELECT count(*)::int AS n FROM maintenance_work_orders WHERE deleted_at IS NULL',
    apply: 'UPDATE maintenance_work_orders SET deleted_at = now() WHERE deleted_at IS NULL',
  },
  {
    label: 'operating expenses',
    count: 'SELECT count(*)::int AS n FROM operating_expenses WHERE deleted_at IS NULL',
    apply: 'UPDATE operating_expenses SET deleted_at = now() WHERE deleted_at IS NULL',
  },
  {
    label: 'in-house occupancy',
    count: "SELECT count(*)::int AS n FROM occupancy WHERE status = 'CHECKED_IN' AND deleted_at IS NULL",
    apply: "UPDATE occupancy SET deleted_at = now(), status = 'CHECKED_OUT' WHERE status = 'CHECKED_IN' AND deleted_at IS NULL",
  },
  {
    label: 'occupied rooms → available',
    count: "SELECT count(*)::int AS n FROM rooms WHERE status = 'OCCUPIED' AND deleted_at IS NULL",
    apply: "UPDATE rooms SET status = 'AVAILABLE' WHERE status = 'OCCUPIED' AND deleted_at IS NULL",
  },
];

const CONNECTION = process.env['DATABASE_URL'] ?? 'postgresql://lsp:lsp@localhost:5432/lsp_dev';
const APPLY = process.argv.includes('--yes');

function hostOf(conn: string): string {
  try {
    return new URL(conn).hostname;
  } catch {
    return '(unparseable)';
  }
}
const host = hostOf(CONNECTION);
const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(host);

async function count(client: InstanceType<typeof Client>, op: Op): Promise<number> {
  const { rows } = await client.query(op.count);
  return rows[0].n as number;
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: CONNECTION,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  console.log(`\n  Database host: ${host}${isLocal ? ' (local)' : ''}`);
  console.log(`  Mode: ${APPLY ? 'APPLY — changes will be written' : 'DRY RUN — nothing will change'}\n`);

  console.log('  To clear:');
  for (const op of OPS) console.log(`    ${op.label.padEnd(28)} ${await count(client, op)}`);
  console.log('');

  if (!APPLY) {
    console.log('  Dry run complete — nothing changed. Re-run with `--yes` to apply.\n');
    await client.end();
    return;
  }

  try {
    await client.query('BEGIN');
    console.log('  Cleared:');
    for (const op of OPS) {
      const res = await client.query(op.apply);
      console.log(`    ${op.label.padEnd(28)} ${String(res.rowCount ?? 0).padStart(4)}`);
    }
    await client.query('COMMIT');
    console.log('\n  ✓ Committed.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n  ✗ Failed — rolled back, nothing changed.', err);
    process.exitCode = 1;
    await client.end();
    return;
  }

  console.log('  Remaining (should all be 0):');
  for (const op of OPS) console.log(`    ${op.label.padEnd(28)} ${await count(client, op)}`);
  console.log('');

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
