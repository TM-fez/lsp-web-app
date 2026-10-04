/**
 * Round 4 (N-1) — REVIEW bookings stranded on a deleted unit or guest.
 *
 * Until the delete guard shipped, `DELETE /rooms/:id` and `DELETE /contacts/:id` succeeded
 * while live bookings still pointed at them: the booking dropped off the board and its paid
 * invoice stayed in Finance. This lists what is affected so the OWNER can review it.
 *
 *   npm run db:repair-orphaned-bookings            # REPORT ONLY — reads, writes nothing (default)
 *   npm run db:repair-orphaned-bookings:apply      # optional: UN-delete the units / guests they
 *                                                  # point at (one audit row each, one transaction)
 *
 * It is NOT run by a deploy, a migration or the scheduler — the owner runs it by hand, on
 * production, after reading the report. It never cancels, deletes or re-prices a booking,
 * and moves no money. Safe to run any number of times: the report is read-only and the
 * restore finds nothing left to do the second time. (`--apply` is accepted as well as
 * `--yes` because `npm run … -- --yes` never reaches a script — npm eats it.)
 *
 * Restoring is only the safe default for "this was deleted by mistake". If the unit really
 * is gone, cancel or move the booking instead (and refund what was paid), then delete again.
 */
import 'dotenv/config';
import { db } from '../config/db.js';
import { findOrphanedBookings, restoreStrandedParents } from '../modules/reservations/reservations.orphans.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--yes') || args.includes('--apply');

const pula = (thebe: number) =>
  `P${(thebe / 100).toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  console.warn('\n  Round 4 — bookings stranded on a deleted unit or guest');
  console.warn(`  Mode: ${APPLY ? 'APPLY — deleted units/guests with live bookings will be restored' : 'REPORT ONLY — nothing will change'}\n`);

  const rows = await findOrphanedBookings(db);
  if (rows.length === 0) {
    console.warn('  Nothing to review: no live or unpaid booking points at a deleted unit or guest.\n');
  } else {
    console.warn(`  ${rows.length} booking(s) need a look:\n`);
    for (const r of rows) {
      const why = [
        r.room_deleted ? `unit ${r.room_code ?? r.room_id} is deleted` : null,
        r.guest_deleted ? `guest ${r.guest_name ?? r.contact_id} is deleted` : null,
        r.billing_contact_deleted ? 'billing contact is deleted' : null,
        r.coordinator_deleted ? 'coordinator is deleted' : null,
      ].filter(Boolean).join('; ');
      console.warn(
        `  • ${r.reservation_id}  ${r.status.padEnd(10)} ${r.check_in_date} → ${r.check_out_date}  ` +
        `paid ${pula(r.paid_amount)}  unpaid ${pula(r.open_invoice_amount)}\n      ${why}`
      );
    }
    console.warn(
      '\n  What to do, per booking: (a) it should still happen → restore the unit/guest\n' +
      '  (`npm run db:repair-orphaned-bookings:apply` restores all of the above), or (b) it is\n' +
      '  really over → cancel it in the app (refund what was paid), then remove the unit/guest.\n'
    );
  }

  if (APPLY && rows.length > 0) {
    const actor = await db.selectFrom('users').select('id').orderBy('created_at', 'asc').limit(1).executeTakeFirst();
    if (!actor) throw new Error('No user to attribute the restore to');
    const result = await restoreStrandedParents(db, actor.id);
    console.warn(`  ✓ Restored ${result.rooms_restored} unit(s) and ${result.contacts_restored} guest(s).\n`);
  } else if (!APPLY && rows.length > 0) {
    console.warn('  Report only — nothing changed.\n');
  }
  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  await db.destroy();
  process.exit(1);
});
