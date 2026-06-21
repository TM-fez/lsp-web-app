/**
 * One-off cleanup: soft-delete all rows of the data that was created while
 * testing the app, so the live system starts from a clean slate. Targets the
 * four tables the operator flagged as test-only:
 *
 *   • reservations
 *   • contacts            (guests)
 *   • maintenance_work_orders
 *   • operating_expenses
 *
 * It is a SOFT delete — every one of these tables has a `deleted_at` column and
 * the whole app filters `deleted_at IS NULL`, so the rows disappear everywhere
 * (counts drop to 0) while staying recoverable at the DB level. No foreign keys
 * are touched, so nothing else can break.
 *
 * Unlike seed-demo this is MEANT to run against the live database, so the guard
 * is the opposite: it does NOTHING unless you pass --yes. Without the flag it is
 * a dry run that only prints what it *would* clear.
 *
 * Usage (from apps/api, with DATABASE_URL pointing at the target DB):
 *   npm run db:purge-test            # dry run — just show the counts
 *   npm run db:purge-test -- --yes   # actually clear them (in a transaction)
 */
import 'dotenv/config';
import pkg from 'pg';

const { Client } = pkg;

const TABLES = ['reservations', 'contacts', 'maintenance_work_orders', 'operating_expenses'] as const;
const LABELS: Record<(typeof TABLES)[number], string> = {
  reservations: 'reservations',
  contacts: 'guests (contacts)',
  maintenance_work_orders: 'maintenance work orders',
  operating_expenses: 'operating expenses',
};

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

async function activeCount(client: InstanceType<typeof Client>, table: string): Promise<number> {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE deleted_at IS NULL`);
  return rows[0].n as number;
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: CONNECTION,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  console.log(`\n  Database host: ${host}${isLocal ? ' (local)' : ''}`);
  console.log(`  Mode: ${APPLY ? 'APPLY — rows will be soft-deleted' : 'DRY RUN — nothing will change'}\n`);

  // What we're about to clear.
  const before: Record<string, number> = {};
  for (const t of TABLES) before[t] = await activeCount(client, t);
  console.log('  Active rows to clear:');
  for (const t of TABLES) console.log(`    ${LABELS[t].padEnd(26)} ${before[t]}`);
  const total = Object.values(before).reduce((a, b) => a + b, 0);
  console.log(`    ${'—'.repeat(26)} ${'—'}`);
  console.log(`    ${'total'.padEnd(26)} ${total}\n`);

  if (!APPLY) {
    console.log('  Dry run complete — nothing changed. Re-run with `-- --yes` to apply.\n');
    await client.end();
    return;
  }

  try {
    await client.query('BEGIN');
    for (const t of TABLES) {
      const res = await client.query(`UPDATE ${t} SET deleted_at = now() WHERE deleted_at IS NULL`);
      console.log(`    cleared ${String(res.rowCount ?? 0).padStart(4)}  ${LABELS[t]}`);
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

  // Confirm the slate is clean.
  console.log('  Remaining active rows (should all be 0):');
  for (const t of TABLES) console.log(`    ${LABELS[t].padEnd(26)} ${await activeCount(client, t)}`);
  console.log('');

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
