import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { todayInPropertyTZ } from '../time.js';

/**
 * Gapless, per-year document numbering (defect D09).
 *
 * Two rules make a number defensible to the owner and to BURS, and the old
 * `INV-<year>-<8 random hex>` kept neither:
 *
 *   · SEQUENCE — a random identifier proves a document exists; only a sequence
 *     proves none has been removed. "Is a document missing?" must be answerable.
 *   · THE PROPERTY DAY — the year comes from the Gaborone wall clock (invariant 2),
 *     not the server's UTC one. An invoice raised at 01:00 Gaborone on 1 January
 *     used to be stamped into the previous year's series, which had already been
 *     reported.
 *
 * Why not a Postgres SEQUENCE: nextval() is non-transactional by design, so a
 * rolled-back insert burns its number for ever — the exact hole this closes. The
 * counter is ordinary transactional data instead, which is why `trx` is required
 * rather than optional: allocating outside the document's own transaction would
 * reintroduce the gap through the back door.
 */

/** Zero-padded width of the sequence part. See migration 068 on why not 8. */
const SEQUENCE_WIDTH = 6;

export type DocumentPrefix = 'INV';

/**
 * Claim the next number in `prefix`'s series for the current property-year.
 *
 * MUST be called inside the transaction that inserts the document, so the number
 * and the document commit together. Concurrent callers serialise on the counter
 * row; the single upsert leaves no read-then-write race to lose.
 */
export async function allocateDocumentNumber(
  trx: Transaction<Database> | Kysely<Database>,
  prefix: DocumentPrefix,
  now: Date = new Date()
): Promise<string> {
  const year = Number(todayInPropertyTZ(now).slice(0, 4));

  const result = await sql<{ last_value: number }>`
    INSERT INTO document_number_series (prefix, year, last_value)
    VALUES (${prefix}, ${year}, 1)
    ON CONFLICT (prefix, year) DO UPDATE
      SET last_value = document_number_series.last_value + 1,
          updated_at = now()
    RETURNING last_value
  `.execute(trx);

  const value = result.rows[0]!.last_value;
  // padStart, not slice: past 999999 the number grows a digit rather than wrapping
  // round to one already on a document in someone's inbox.
  return `${prefix}-${year}-${String(value).padStart(SEQUENCE_WIDTH, '0')}`;
}
