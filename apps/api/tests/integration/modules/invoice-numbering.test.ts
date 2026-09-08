/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Gapless per-year document numbering (defect D09, migration 068).
 *
 * Why this suite is integration rather than unit: every claim D09 makes is a claim
 * about PostgreSQL. "No gaps" means the counter rolls back with the transaction that
 * abandoned it; "no collisions" means concurrent callers serialise on the row lock.
 * A mocked database can only confirm that the mock counted, which is not the property
 * under test.
 *
 * The absolute assertions run in years 2997–2999. The real series (the current year)
 * is shared with every other suite that raises an invoice and with the row this test
 * DB already carries, so asserting "this is number 1" against it would be a race
 * dressed up as a test. A far-future year gives each case a series of its very own.
 * The one case that must use the live series — that the repository numbers the row it
 * inserts — asserts a RELATIVE step of exactly one instead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { allocateDocumentNumber } from '../../../src/core/documents/numbering.js';
import { InvoicesRepository } from '../../../src/modules/invoices/invoices.repository.js';

// A date whose Gaborone year is the number, chosen well clear of the wall clock.
const inYear = (year: number) => new Date(`${year}-06-15T10:00:00Z`);
// One year per case: a series shared between two cases is a test that depends on the
// order they happen to run in.
const RESERVED_YEARS = [2995, 2996, 2997, 2998, 2999];

let userId: string;

async function clearReservedYears() {
  await db
    .deleteFrom('document_number_series')
    .where('year', 'in', RESERVED_YEARS)
    .execute();
}

beforeAll(async () => {
  // Any real user satisfies the invoice's NOT NULL issued_by/created_by/updated_by.
  const user = await db.selectFrom('users').select('id').limit(1).executeTakeFirstOrThrow();
  userId = user.id;
  await clearReservedYears();
});

afterAll(async () => {
  await clearReservedYears();
});

describe('allocateDocumentNumber — the series counts', () => {
  it('hands out 1, then 2, in a year of its own', async () => {
    const first = await allocateDocumentNumber(db, 'INV', inYear(2999));
    const second = await allocateDocumentNumber(db, 'INV', inYear(2999));

    expect(first).toBe('INV-2999-000001');
    expect(second).toBe('INV-2999-000002');
  });

  // The width is load-bearing, not cosmetic: legacy numbers are 8 hex characters, so
  // six digits is what keeps the two formats different LENGTHS and the UNIQUE
  // constraint on invoices.number satisfiable. See migration 068.
  it('zero-pads the sequence to six digits', async () => {
    const number = await allocateDocumentNumber(db, 'INV', inYear(2999));
    expect(number).toMatch(/^INV-2999-\d{6}$/);
  });

  it('gives each year its own series, starting again at 1', async () => {
    await allocateDocumentNumber(db, 'INV', inYear(2999));
    const otherYear = await allocateDocumentNumber(db, 'INV', inYear(2998));

    expect(otherYear).toBe('INV-2998-000001');
  });
});

describe('allocateDocumentNumber — the series has no gaps', () => {
  /**
   * The whole reason this is a table and not a Postgres SEQUENCE. nextval() would
   * hand out 1, burn 2 on the doomed transaction, and return 3 — a hole that no
   * later audit can distinguish from a document someone deleted.
   */
  it('leaves no gap when the transaction that claimed a number rolls back', async () => {
    const first = await allocateDocumentNumber(db, 'INV', inYear(2997));
    expect(first).toBe('INV-2997-000001');

    await expect(
      db.transaction().execute(async (trx) => {
        const claimed = await allocateDocumentNumber(trx, 'INV', inYear(2997));
        expect(claimed).toBe('INV-2997-000002');
        throw new Error('the invoice insert failed after the number was claimed');
      })
    ).rejects.toThrow(/insert failed/);

    // 2 again, not 3: the abandoned claim died with its transaction.
    const next = await allocateDocumentNumber(db, 'INV', inYear(2997));
    expect(next).toBe('INV-2997-000002');
  });

  it('never hands the same number to two concurrent callers', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 10 }, () => allocateDocumentNumber(db, 'INV', inYear(2996)))
    );

    // A contiguous 1..10 in some order — no duplicates, and nothing skipped.
    expect([...new Set(numbers)]).toHaveLength(10);
    expect([...numbers].sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `INV-2996-${String(i + 1).padStart(6, '0')}`)
    );
  });
});

describe('allocateDocumentNumber — the year is the property day', () => {
  /**
   * D09's second half, and the one a UTC server gets silently wrong. 22:30 UTC on 31
   * December is already 00:30 on 1 January in Gaborone (UTC+2), so the invoice belongs
   * to the NEW year's series. Stamping it 2025 files it into a year that has already
   * been reported to BURS.
   */
  it('stamps the new year for an invoice raised just after midnight in Gaborone', async () => {
    const justAfterGaboroneMidnight = new Date('2994-12-31T22:30:00Z');
    const number = await allocateDocumentNumber(db, 'INV', justAfterGaboroneMidnight);

    // 2995, not 2994 — and the sequence starts at 1, so it is genuinely the new
    // year's series and not a late arrival in the old one.
    expect(number).toBe('INV-2995-000001');
  });
});

describe('InvoicesRepository — the row and its number commit together', () => {
  it('numbers the invoice it inserts, taking the next value in the live series', async () => {
    const repo = new InvoicesRepository(db);
    const meta = { userId };

    const before = await allocateDocumentNumber(db, 'INV');

    const invoice = await repo.create(
      {
        hold_id: null,
        quote_id: null,
        reservation_id: null,
        kind: 'BALANCE',
        currency: 'BWP',
        subtotal_amount: 100_000,
        tax_rate_bps: 1400,
        tax_amount: 14_000,
        total_amount: 114_000,
        issued_by: userId,
        created_by: userId,
        updated_by: userId,
      },
      meta
    );

    // Relative, not absolute: the live series is shared with every other suite.
    const seq = (n: string) => Number(n.slice(n.lastIndexOf('-') + 1));
    expect(seq(invoice.number)).toBe(seq(before) + 1);
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{6}$/);

    // Hard-delete rather than soft: a test fixture must not sit in the receivables
    // ledger. This does burn a number in the test database's live series — which is
    // precisely the hole that void-instead-of-delete closes for real documents (G30
    // scope). Nothing in the application hard-deletes an invoice.
    await sql`DELETE FROM audit_logs WHERE entity = 'invoices' AND entity_id = ${invoice.id}`.execute(db);
    await sql`DELETE FROM invoices WHERE id = ${invoice.id}`.execute(db);
  });
});
