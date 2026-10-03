import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';

/**
 * Run `fn` in a transaction — joining the caller's one when `db` already IS a
 * transaction.
 *
 * Why this exists (stage-1 money fixes): the money writes used to be a chain of
 * independent transactions (quote, hold, intent, settle, receipt, balance invoice), so
 * two parallel payments could each pass a read-then-write check and both succeed, and a
 * crash between steps left a payment with no invoice. Kysely refuses to nest
 * `.transaction()` on a Transaction, so a repository that wants to be usable BOTH
 * standalone and as one step of a bigger unit of work goes through this instead.
 * Construct it with a `Transaction` (`new QuotesRepository(trx)`) and every method joins
 * that transaction; construct it with the pool and each method opens its own.
 */
export async function inTransaction<T>(
  db: Kysely<Database>,
  fn: (trx: Transaction<Database>) => Promise<T>
): Promise<T> {
  if (db.isTransaction) return fn(db as Transaction<Database>);
  return db.transaction().execute(fn);
}
