/**
 * One-off migration of the Little Hotelier guest list into CRM contacts.
 *
 * The export is one row per *stay* (3,426 rows for ~1,800 parties), so the deduplication,
 * name/phone normalisation and individual-vs-company classification all happen OUTSIDE this
 * script — it consumes the reviewed CSV that came out of that pass and does nothing clever.
 * That split is deliberate: the judgement calls were signed off by the owner as a list of
 * rows, and this tool's only job is to put those exact rows in the database, verifiably.
 *
 * CSV contract (header row required, extra columns ignored):
 *   Type, Name, Email, Phone, Company, Address, Notes
 *   • Type must be `individual` or `company` (anything else → row rejected).
 *   • Name is required; everything else may be blank.
 *
 * Safety, mirroring `purge-test-data.ts` since this also runs against the LIVE database:
 *   • Dry run unless told otherwise. The dry run reports exactly what a real run would do.
 *   • Every insert carries its audit_logs row in the SAME transaction, and the whole import
 *     is ONE transaction — it either all lands or none of it does.
 *   • Idempotent: re-running skips anyone already present. A match is the same email address,
 *     or the same name on the same phone number — never the phone alone, because the reviewed
 *     list deliberately keeps couples and colleagues who booked on one number as separate
 *     people. So a second run adds nothing rather than doubling the CRM.
 *
 * Usage (DATABASE_URL points at the target DB):
 *   npm run db:import-guests -- <file.csv>          # dry run — counts only
 *   npm run db:import-guests:apply -- <file.csv>    # actually write them
 *
 * The write flag lives INSIDE the :apply script rather than being passed on the command line
 * because npm eats `--`-flags as its own config — `npm run … -- --yes` reaches the script as
 * no flag at all, silently turning an intended write into a dry run. Positional arguments
 * (the file path) do come through. Straight through tsx everything works normally:
 *   npx tsx apps/api/src/db/import-guests.ts <file.csv> --limit 25
 *   npx tsx apps/api/src/db/import-guests.ts <file.csv> --yes
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pkg from 'pg';

const { Client } = pkg;

// Seeded by migration 061 — a non-login service user that owns the imported rows.
const IMPORT_USER_ID = '00000000-0000-4000-a000-000000000003';

// contacts column limits (see CreateContactSchema / db/types.ts). Over-long values are
// truncated rather than rejected: losing the tail of an address beats losing the guest.
const LIMITS = { name: 255, email: 255, phone: 50, company: 255, address: 1000 } as const;

// Contacts per INSERT. 500 × 9 placeholders is well inside Postgres' 65,535-parameter ceiling,
// and keeps each statement small enough to stay responsive over a slow link.
const BATCH_SIZE = 500;

interface CsvContact {
  line: number;
  type: 'individual' | 'company';
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  notes: string | null;
}

// ── CSV ─────────────────────────────────────────────────────────────────────
// Hand-rolled rather than pulling in a parser: adding a dependency churns
// package-lock.json, and the channel importer set the precedent with its iCal parser.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      // Swallow the \n of a \r\n pair; a bare \r also ends the row.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function trunc(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function blankToNull(value: string | undefined, max: number): string | null {
  const v = (value ?? '').trim();
  return v === '' ? null : trunc(v, max);
}

interface ParseResult {
  contacts: CsvContact[];
  rejected: { line: number; reason: string }[];
}

function readContacts(path: string): ParseResult {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (rows.length === 0) throw new Error(`${path} is empty`);

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string): number => header.indexOf(name);
  const idx = {
    type: col('type'),
    name: col('name'),
    email: col('email'),
    phone: col('phone'),
    company: col('company'),
    address: col('address'),
    notes: col('notes'),
  };
  for (const [key, at] of Object.entries(idx)) {
    if (at === -1) throw new Error(`${path} has no "${key}" column (found: ${header.join(', ')})`);
  }

  const contacts: CsvContact[] = [];
  const rejected: { line: number; reason: string }[] = [];

  rows.slice(1).forEach((raw, i) => {
    const line = i + 2; // 1-based, +1 for the header
    const type = (raw[idx.type] ?? '').trim().toLowerCase();
    const name = (raw[idx.name] ?? '').trim();

    if (name === '') {
      rejected.push({ line, reason: 'no name' });
      return;
    }
    if (type !== 'individual' && type !== 'company') {
      rejected.push({ line, reason: `type is "${type || '(blank)'}", expected individual|company` });
      return;
    }

    contacts.push({
      line,
      type,
      name: trunc(name, LIMITS.name),
      email: blankToNull(raw[idx.email], LIMITS.email),
      phone: blankToNull(raw[idx.phone], LIMITS.phone),
      company: blankToNull(raw[idx.company], LIMITS.company),
      address: blankToNull(raw[idx.address], LIMITS.address),
      notes: blankToNull(raw[idx.notes], 100_000),
    });
  });

  return { contacts, rejected };
}

// ── Batching ───────────────────────────────────────────────────────────────
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Identity ────────────────────────────────────────────────────────────────
// Same rules the cleaning pass used, so "already imported" means the same thing on both
// sides: last 8 digits of the phone (one guest is stored as +267 76 255 071, 26776255071
// and 76255071), and a case-folded name as the last resort.
export function phoneKey(phone: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : digits;
}

export function keysOf(c: { email: string | null; phone: string | null; name: string }): string[] {
  const keys: string[] = [];
  if (c.email) keys.push(`e:${c.email.trim().toLowerCase()}`);
  // Name AND phone together, never phone alone: the reviewed list deliberately holds couples
  // and colleagues who booked on one number as separate people (Ghulam Abbas and Zaheer Abbas
  // share +27 84 292 7211). Matching on the phone by itself silently swallowed 32 of them.
  keys.push(`np:${c.name.trim().toLowerCase()}|${phoneKey(c.phone)}`);
  return keys;
}

// ── Run ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
// `--apply` as well as `--yes` because `npm run … -- --yes` never reaches us: npm has its own
// --yes and eats it. Via `npx tsx` either works.
const APPLY = args.includes('--yes') || args.includes('--apply');
const limitAt = args.indexOf('--limit');
const LIMIT = limitAt === -1 ? Infinity : Number(args[limitAt + 1]);
const FILE = args.find((a) => !a.startsWith('--') && a !== String(LIMIT));

const CONNECTION = process.env['DATABASE_URL'] ?? 'postgresql://lsp:lsp@localhost:5432/lsp_dev';

function hostOf(conn: string): string {
  try {
    return new URL(conn).hostname;
  } catch {
    return '(unparseable)';
  }
}

async function main(): Promise<void> {
  if (!FILE) {
    console.error('\n  Usage: npm run db:import-guests -- <file.csv> [--limit N] [--yes]\n');
    process.exitCode = 1;
    return;
  }
  if (limitAt !== -1 && !Number.isFinite(LIMIT)) {
    console.error('\n  --limit needs a number, e.g. --limit 25\n');
    process.exitCode = 1;
    return;
  }

  const { contacts, rejected } = readContacts(FILE);
  const wanted = contacts.slice(0, LIMIT === Infinity ? contacts.length : LIMIT);

  const host = hostOf(CONNECTION);
  const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(host);
  const client = new Client({
    connectionString: CONNECTION,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    // Render sits behind a proxy that drops quiet connections; the import holds one open for
    // the length of a transaction, so keep the socket warm.
    keepAlive: true,
  });
  await client.connect();

  console.log(`\n  File:          ${FILE}`);
  console.log(`  Database host: ${host}${isLocal ? ' (local)' : ''}`);
  console.log(`  Mode:          ${APPLY ? 'APPLY — contacts will be created' : 'DRY RUN — nothing will change'}`);
  if (LIMIT !== Infinity) console.log(`  Limit:         first ${LIMIT} rows`);
  console.log('');

  // The actor must exist or created_by would dangle — migration 061 seeds it.
  const { rows: actor } = await client.query('SELECT 1 FROM users WHERE id = $1', [IMPORT_USER_ID]);
  if (actor.length === 0) {
    console.error(`  ✗ Import user ${IMPORT_USER_ID} is missing. Run migrations first (db:migrate).\n`);
    await client.end();
    process.exitCode = 1;
    return;
  }

  // Everyone already in the CRM, so a re-run is a no-op rather than a duplicate.
  const { rows: existing } = await client.query<{ name: string; email: string | null; phone: string | null }>(
    'SELECT name, email, phone FROM contacts WHERE deleted_at IS NULL'
  );
  const seen = new Set<string>();
  for (const row of existing) for (const k of keysOf(row)) seen.add(k);

  const toInsert: CsvContact[] = [];
  const skipped: { line: number; name: string }[] = [];
  for (const c of wanted) {
    const keys = keysOf(c);
    if (keys.some((k) => seen.has(k))) {
      skipped.push({ line: c.line, name: c.name });
      continue;
    }
    // Guard the file against itself, too: two rows for one person insert once.
    for (const k of keys) seen.add(k);
    toInsert.push(c);
  }

  console.log(`  Rows in file:        ${contacts.length + rejected.length}`);
  console.log(`  Unusable rows:       ${rejected.length}`);
  console.log(`  Already in the CRM:  ${skipped.length}`);
  console.log(`  To create:           ${toInsert.length}`);
  console.log(`    individuals ${toInsert.filter((c) => c.type === 'individual').length}, ` +
              `companies ${toInsert.filter((c) => c.type === 'company').length}`);
  console.log(`    with a phone ${toInsert.filter((c) => c.phone).length}, ` +
              `with an email ${toInsert.filter((c) => c.email).length}`);
  console.log('');

  for (const r of rejected.slice(0, 10)) console.log(`    line ${r.line}: skipped — ${r.reason}`);
  if (rejected.length > 10) console.log(`    …and ${rejected.length - 10} more unusable rows`);
  if (rejected.length) console.log('');

  if (!APPLY) {
    console.log('  Sample of what would be created:');
    for (const c of toInsert.slice(0, 5)) {
      console.log(`    ${c.type.padEnd(10)} ${c.name.slice(0, 30).padEnd(32)} ${(c.phone ?? '—').padEnd(18)} ${c.email ?? ''}`);
    }
    console.log('\n  Dry run complete — nothing changed. Re-run with `--yes` to apply.\n');
    await client.end();
    return;
  }

  if (toInsert.length === 0) {
    console.log('  Nothing to do — every row is already in the CRM.\n');
    await client.end();
    return;
  }

  // One request id for the whole run, so the audit trail can be filtered back to this import.
  // audit_logs.request_id is a uuid column, so it is a bare UUID — the "this was the import"
  // marker lives in diff.source instead.
  const requestId = randomUUID();
  let created = 0;

  try {
    await client.query('BEGIN');
    // Batched, not row-by-row. Row-by-row meant two round trips per contact — 2,682 of them
    // for this list — and against Render's free tier from Botswana that ran for ten minutes
    // before the TLS connection dropped mid-transaction (ETIMEDOUT) and the whole import
    // rolled back. Batching turns it into six round trips. Ids are generated here rather than
    // read back from RETURNING so the audit rows can reference them without depending on
    // multi-row RETURNING coming back in VALUES order.
    for (const [batchIndex, batch] of chunk(toInsert, BATCH_SIZE).entries()) {
      const withIds = batch.map((c) => ({ ...c, id: randomUUID() }));

      const contactParams: unknown[] = [];
      const contactRows = withIds.map((c) => {
        const n = contactParams.length;
        contactParams.push(c.id, c.type, c.name, c.email, c.phone, c.company, c.address, c.notes,
                           IMPORT_USER_ID);
        // created_by and updated_by are the same actor, so $n+9 is reused for both.
        return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, ` +
               `$${n + 8}, $${n + 9}, $${n + 9})`;
      });
      await client.query(
        `INSERT INTO contacts (id, type, name, email, phone, company, address, notes,
                               created_by, updated_by)
         VALUES ${contactRows.join(', ')}`,
        contactParams
      );

      // $1 and $2 are the same for every row of the run, so they are bound once and reused.
      const auditParams: unknown[] = [requestId, IMPORT_USER_ID];
      const auditRows = withIds.map((c) => {
        const n = auditParams.length;
        auditParams.push(c.id, JSON.stringify({ source: 'little-hotelier-export', ...c }));
        return `($1, $2, 'CREATE', 'contacts', $${n + 1}, $${n + 2}, NULL)`;
      });
      await client.query(
        `INSERT INTO audit_logs (request_id, user_id, action, entity, entity_id, diff, ip_address)
         VALUES ${auditRows.join(', ')}`,
        auditParams
      );

      created += batch.length;
      console.log(`    batch ${batchIndex + 1}: ${created}/${toInsert.length} written`);
    }
    await client.query('COMMIT');
    console.log(`  ✓ Committed — ${created} contacts created.`);
    console.log(`    Audit trail: SELECT * FROM audit_logs WHERE request_id = '${requestId}';\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n  ✗ Failed — rolled back, nothing was created.', err);
    process.exitCode = 1;
    await client.end();
    return;
  }

  const { rows: after } = await client.query<{ n: string }>(
    'SELECT count(*)::int AS n FROM contacts WHERE deleted_at IS NULL'
  );
  console.log(`  Contacts in the CRM now: ${after[0]!.n}\n`);

  await client.end();
}

// Only run when invoked as a script — importing the module (the unit tests do) must not
// open a database connection.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
