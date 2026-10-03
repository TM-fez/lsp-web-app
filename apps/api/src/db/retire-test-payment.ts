/**
 * Retire a TEST payment by retiring the booking behind it: cancel the booking, then
 * soft-delete it — the same two steps as "Cancel booking" → "Remove from list" in the
 * app, through the same repository code, each with its audit row.
 *
 * Why this exists: the invoice backfill now skips payments whose booking was deleted
 * (purged test data), but an earlier purge missed a few test bookings, so their payments
 * still look real and would be given receipts — i.e. booked as revenue. The owner can
 * identify them by the payment id the backfill prints, from a phone, in the Render shell;
 * finding and clicking through each booking in the app is not practical there.
 *
 * Nothing is deleted outright — soft delete only, reversible at the DB level.
 *
 * Usage (Render shell, from the repo root). Dry run by default; prints the booking first:
 *   npx tsx apps/api/src/db/retire-test-payment.ts <payment-id> [<payment-id> …]
 *   npx tsx apps/api/src/db/retire-test-payment.ts <payment-id> … --yes
 */
import 'dotenv/config';
import { sql } from 'kysely';
import { db } from '../config/db.js';
import { ReservationsRepository } from '../modules/reservations/reservations.repository.js';
import { TERMINAL_RESERVATION_STATUSES } from '../core/money/folio.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--yes') || args.includes('--apply');
const ids = args.filter((a) => !a.startsWith('--'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pula(thebe: number): string {
  return `P${(thebe / 100).toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main(): Promise<void> {
  const bad = ids.filter((id) => !UUID.test(id));
  if (ids.length === 0 || bad.length > 0) {
    console.error('\n  Give one or more payment ids (as printed by the invoice backfill).');
    if (bad.length) console.error(`  Not a payment id: ${bad.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Attributed to the system actor, the same rule the backfills use.
  const actor = await db.selectFrom('users').select('id').orderBy('created_at', 'asc').limit(1).executeTakeFirstOrThrow();
  const meta = { userId: actor.id, ip: undefined, requestId: undefined };
  const reservations = new ReservationsRepository(db);

  console.warn(`\n  Retire test payments — ${APPLY ? 'APPLY: bookings will be cancelled and removed' : 'DRY RUN: nothing will change'}\n`);

  for (const id of ids) {
    const row = await db
      .selectFrom('payment_intents as pi')
      .leftJoin('holds as h', 'h.id', 'pi.hold_id')
      .leftJoin('reservations as r', 'r.id', 'h.reservation_id')
      .leftJoin('contacts as c', 'c.id', 'r.contact_id')
      .leftJoin('rooms as rm', 'rm.id', 'r.room_id')
      .select([
        'pi.amount',
        'pi.status as payment_status',
        'r.id as reservation_id',
        'r.status as reservation_status',
        'r.deleted_at',
        'c.name as guest',
        'rm.code as unit',
        sql<string | null>`to_char(pi.paid_at AT TIME ZONE 'Africa/Gaborone', 'YYYY-MM-DD')`.as('paid_on'),
        sql<string | null>`to_char(r.check_in_date, 'YYYY-MM-DD')`.as('check_in'),
        sql<string | null>`to_char(r.check_out_date, 'YYYY-MM-DD')`.as('check_out'),
      ])
      .where('pi.id', '=', id)
      .executeTakeFirst();

    if (!row) {
      console.warn(`  ${id}  — no such payment. Skipped.\n`);
      continue;
    }
    console.warn(`  Payment ${id}`);
    console.warn(`    ${pula(row.amount)} ${row.payment_status}, paid ${row.paid_on ?? '—'}`);
    if (!row.reservation_id) {
      console.warn('    No booking behind this payment — nothing to retire. Skipped.\n');
      continue;
    }
    console.warn(`    Booking ${row.reservation_id}`);
    console.warn(`    Guest ${row.guest ?? '—'} · unit ${row.unit ?? '—'} · ${row.check_in ?? '?'} → ${row.check_out ?? '?'} · ${row.reservation_status}`);

    if (row.deleted_at) {
      console.warn('    Already removed. Nothing to do.\n');
      continue;
    }
    if (!APPLY) {
      console.warn('    Would: cancel this booking, then remove it from the lists.\n');
      continue;
    }

    // Cancel first (the update path voids anything it still owed and audits it), then the
    // soft delete — the app's own order, so the room is freed before the row disappears.
    if (!(TERMINAL_RESERVATION_STATUSES as readonly string[]).includes(row.reservation_status!)) {
      await reservations.update(row.reservation_id, { status: 'CANCELLED', updated_by: meta.userId }, meta);
    }
    await reservations.softDelete(row.reservation_id, meta);
    console.warn('    ✓ Cancelled and removed.\n');
  }

  if (!APPLY) {
    console.warn('  Dry run complete — nothing changed. Re-run the same command with --yes on the end to apply.\n');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
