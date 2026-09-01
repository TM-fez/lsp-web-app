/**
 * One-off import: guests exported from Little Hotelier (last 6 months) into contacts.
 *
 * The dataset (import-lh-guests.json, built from the raw export) is already cleaned:
 * deduped per person, Booking.com relay emails dropped, companies split out, and
 * unreachable one-stay guests excluded — see the cleaning notes in the JSON's source.
 *
 * Safety, matching purge-test-data.ts:
 *   • Dry run by default — prints add/skip counts, writes NOTHING without --yes.
 *   • Never doubles anyone: a live contact with the same email, phone, or
 *     (case-insensitive) name is skipped.
 *   • Every inserted row's notes start with "Imported from Little Hotelier" so the
 *     whole batch can be found — or soft-deleted — with one query later.
 *
 * Usage (with DATABASE_URL pointing at the target DB):
 *   npx tsx apps/api/src/db/import-lh-guests.ts        # dry run
 *   npx tsx apps/api/src/db/import-lh-guests.ts --yes  # actually insert
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pkg from 'pg';

const { Client } = pkg;

interface LhContact {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  stays: number;
  type: 'individual' | 'company';
  extra_note?: string;
}

const IMPORT_TAG = 'Imported from Little Hotelier (Aug 2026)';

function buildNotes(c: LhContact): string {
  const stays = `${c.stays} stay${c.stays === 1 ? '' : 's'} in the last 6 months`;
  return [`${IMPORT_TAG} — ${stays}.`, c.extra_note].filter(Boolean).join(' ');
}

async function main() {
  const execute = process.argv.includes('--yes');
  const dataPath = join(dirname(fileURLToPath(import.meta.url)), 'import-lh-guests.json');
  const contacts: LhContact[] = JSON.parse(readFileSync(dataPath, 'utf8'));

  const client = new Client({
    connectionString: process.env['DATABASE_URL'] ?? 'postgresql://lsp:lsp@localhost:5432/lsp_dev',
  });
  await client.connect();

  try {
    // created_by/updated_by are NOT NULL — attribute the batch to the admin user.
    const admin = await client.query(
      `SELECT u.id, u.email FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'admin' AND u.active
       ORDER BY u.created_at LIMIT 1`,
    );
    if (admin.rowCount === 0) throw new Error('no active admin user found to attribute the import to');
    const adminId: string = admin.rows[0].id;

    const existing = await client.query(
      `SELECT lower(name) AS name, lower(email) AS email, regexp_replace(phone, '[^0-9+]', '', 'g') AS phone
       FROM contacts WHERE deleted_at IS NULL`,
    );
    const liveNames = new Set<string>();
    const liveEmails = new Set<string>();
    const livePhones = new Set<string>();
    for (const row of existing.rows) {
      if (row.name) liveNames.add(row.name);
      if (row.email) liveEmails.add(row.email);
      if (row.phone) livePhones.add(row.phone);
    }

    let added = 0;
    const skipped: string[] = [];
    for (const c of contacts) {
      const nameKey = c.name.toLowerCase();
      const phoneKey = c.phone ? c.phone.replace(/[^0-9+]/g, '') : null;
      const isDupe =
        liveNames.has(nameKey) ||
        (c.email !== null && liveEmails.has(c.email.toLowerCase())) ||
        (phoneKey !== null && phoneKey.length > 0 && livePhones.has(phoneKey));
      if (isDupe) {
        skipped.push(c.name);
        continue;
      }

      if (execute) {
        await client.query(
          `INSERT INTO contacts (type, name, email, phone, address, notes, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [c.type, c.name, c.email, c.phone, c.address, buildNotes(c), adminId],
        );
      }
      // count the new row toward dedup so the file can't double-insert its own entries
      liveNames.add(nameKey);
      if (c.email) liveEmails.add(c.email.toLowerCase());
      if (phoneKey) livePhones.add(phoneKey);
      added += 1;
    }

    const mode = execute ? 'INSERTED' : 'would insert (dry run — nothing written)';
    console.log(`target DB: ${client.host}:${client.port}/${client.database}`);
    console.log(`attributed to admin: ${admin.rows[0].email}`);
    console.log(`${mode}: ${added} of ${contacts.length}`);
    console.log(`skipped as already present: ${skipped.length}`);
    if (skipped.length > 0) console.log(`  ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ', …' : ''}`);
    if (!execute) console.log('\nRun again with --yes to write.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
