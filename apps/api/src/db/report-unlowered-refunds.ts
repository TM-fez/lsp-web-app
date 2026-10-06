/**
 * (R10 #6) REPORT ONLY — live bookings refunded in full before refunds lowered the agreed
 * total (2026-10-02). Their folio now reads "fully refunded", but on paper they still owe
 * the whole stay. Each needs a person to decide: the stay is off → cancel it in the app; the
 * guest is staying and should pay → take the payment as usual.
 *
 *   npm run db:report-unlowered-refunds     # reads, writes nothing. Owner runs it on production.
 *
 * Not run by a deploy, a migration or the scheduler. Safe to run any number of times.
 */
import 'dotenv/config';
import { db } from '../config/db.js';
import { findUnloweredRefunds } from '../modules/reservations/reservations.unlowered.js';

const pula = (thebe: number) =>
  `P${(thebe / 100).toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  console.warn('\n  R10 — live bookings refunded in full whose agreed total was never lowered');
  console.warn('  Mode: REPORT ONLY — nothing will change\n');
  const rows = await findUnloweredRefunds(db);
  if (rows.length === 0) {
    console.warn('  Nothing to review: every fully refunded live booking already reads P0.\n');
  } else {
    console.warn(`  ${rows.length} booking(s) need a look:\n`);
    for (const r of rows) {
      console.warn(
        `  • ${r.reservation_id}  ${r.status.padEnd(11)} ${r.guest_name ?? 'Guest'} · ${r.room_code ?? '—'}  ` +
          `${r.check_in_date} → ${r.check_out_date}  agreed ${pula(r.agreed_total)}  refunded ${pula(r.refunded)}`
      );
    }
    console.warn(
      '\n  Per booking: the stay is off → cancel it in the app (nothing more is owed);\n' +
        '  the guest is staying and should pay → take the payment as usual.\n'
    );
  }
  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  await db.destroy();
  process.exit(1);
});
