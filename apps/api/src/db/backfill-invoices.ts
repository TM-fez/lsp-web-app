/**
 * Raise a PAID receipt invoice for every settled payment that has none.
 *
 * Only the desk-payment path (`ReservationsService.recordPayment`) raises a
 * receipt today. Paid intents from the commercial money-loop (and any desk
 * payment whose invoice raise failed after settlePaid) left collected money
 * invisible to Accounts. This is the one-off that closes that gap.
 *
 * Like the revenue backfill and purge-test-data, this is MEANT to run against
 * the live database, so the guard is the same: it does NOTHING unless you pass
 * --yes / --apply. Without the flag it is a dry run that prints exactly what it
 * would write.
 *
 * Safe to re-run: intents that already carry `invoice_id` are skipped; a matching
 * unclaimed PAID invoice on the same hold is linked rather than duplicated.
 *
 * PHASE 2 (receivables) then makes every booking's OPEN invoice equal what its folio says
 * is still owed: stale part-payment balance invoices are voided (never deleted), missing
 * ones are raised (pay-later, wizard deposits, public bookings, checkouts), and a part-paid
 * booking's open invoice becomes PARTIALLY_PAID. See invoices.receivables-backfill.ts.
 * Bookings with no known price are LISTED, not priced — pass --reconstruct-prices (run this
 * file directly: `npx tsx src/db/backfill-invoices.ts --apply --reconstruct-prices`) to
 * price them at today's rate plan, after reading that list. `--reservation=<uuid>` limits
 * phase 2 to specific bookings (repeatable) so you can try one before the whole ledger.
 *
 * Usage (with DATABASE_URL pointing at the target DB). Applying has its OWN
 * script rather than a flag, because `npm run … -- --yes` never reaches us —
 * npm has its own --yes and eats it:
 *   npm run db:backfill-invoices           # dry run
 *   npm run db:backfill-invoices:apply     # apply
 */
import 'dotenv/config';
import { db } from '../config/db.js';
import { runInvoiceBackfill } from '../modules/invoices/invoices.backfill.js';
import { runReceivablesBackfill } from '../modules/invoices/invoices.receivables-backfill.js';

const args = process.argv.slice(2);
// `--apply` as well as `--yes` because `npm run … -- --yes` never reaches us.
const APPLY = args.includes('--yes') || args.includes('--apply');
const RECONSTRUCT = args.includes('--reconstruct-prices');
// `--reservation=<uuid>` (repeatable) limits phase 2 to those bookings — try one first.
const ONLY = args.filter((a) => a.startsWith('--reservation=')).map((a) => a.slice('--reservation='.length));

/** Thebe to Pula, for reading. Money is integer minor units everywhere else. */
function pula(thebe: number): string {
  return `P${(thebe / 100).toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  console.warn('\n  Invoice backfill — receipts for settled payments, then open invoices vs. folios');
  console.warn(`  Mode:   ${APPLY ? 'APPLY — invoices will be raised / linked' : 'DRY RUN — nothing will change'}`);
  console.warn('');

  const result = await runInvoiceBackfill(db, { dryRun: !APPLY });

  const row = (label: string, value: string | number) =>
    console.warn(`    ${label.padEnd(34)} ${String(value).padStart(14)}`);

  console.warn(`  ${APPLY ? 'Written' : 'Would write'}:`);
  row('paid intents examined', result.examined);
  row('existing invoices linked', result.linked);
  row('receipt invoices created', result.created);
  row('failed', result.failed);

  const amountCreated = result.details
    .filter((d) => d.action === 'create')
    .reduce((sum, d) => sum + d.amount, 0);
  const amountLinked = result.details
    .filter((d) => d.action === 'link')
    .reduce((sum, d) => sum + d.amount, 0);

  if (result.created > 0 || result.linked > 0) {
    console.warn('');
    row('receipt value to create', pula(amountCreated));
    row('receipt value to link', pula(amountLinked));
  }

  if (result.details.some((d) => d.action === 'fail')) {
    console.warn('\n  Failures:');
    for (const d of result.details.filter((x) => x.action === 'fail')) {
      console.warn(`    ${d.payment_intent_id}  ${pula(d.amount)} ${d.purpose} — ${d.reason ?? 'unknown'}`);
    }
  }

  // Keep the dry-run readable: list every intended action, not just totals.
  if (!APPLY && result.details.length > 0 && result.details.length <= 50) {
    console.warn('\n  Detail:');
    for (const d of result.details) {
      const inv = d.invoice_id ? ` → ${d.invoice_id}` : '';
      console.warn(
        `    ${d.action.padEnd(6)} ${d.payment_intent_id}  ${pula(d.amount)} ${d.purpose}${inv}`
      );
    }
  }

  // ── Phase 2: receivables ──────────────────────────────────────────────────────
  console.warn('\n  Phase 2 — open invoices vs. folio outstanding');
  const rec = await runReceivablesBackfill(db, {
    dryRun: !APPLY,
    reconstructPrices: RECONSTRUCT,
    reservationIds: ONLY.length > 0 ? ONLY : undefined,
  });
  console.warn(`  ${APPLY ? 'Written' : 'Would write'}:`);
  row('bookings examined', rec.examined);
  row('already in agreement', rec.in_agreement);
  row('bookings changed', rec.changed);
  row('stale open invoices voided', rec.voided);
  row('open invoices resized', rec.resized);
  row('balance invoices raised', rec.created);
  row('folio totals frozen', rec.froze_totals);
  row('voided on deleted bookings', rec.voided_on_deleted);
  row('failed', rec.failed.length);

  if (rec.needs_price.length > 0) {
    console.warn(
      `\n  ${rec.needs_price.length} live booking(s) have NO known price and were left alone` +
        (RECONSTRUCT ? ' (could not be priced either):' : ' (re-run with --reconstruct-prices to price them at TODAY\'s rates):')
    );
    for (const n of rec.needs_price.slice(0, 50)) {
      console.warn(`    ${n.reservation_id}  ${n.status}  paid ${pula(n.paid)}`);
    }
  }
  if (rec.overpaid.length > 0) {
    console.warn(`\n  ${rec.overpaid.length} booking(s) have received MORE than their total — needs a human (refund due, or wrong total):`);
    for (const o of rec.overpaid.slice(0, 50)) {
      console.warn(`    ${o.reservation_id}  total ${pula(o.total)}  paid ${pula(o.paid)}`);
    }
  }
  for (const f of rec.failed) console.warn(`    FAILED ${f.reservation_id} — ${f.reason}`);
  if (!APPLY && rec.details.length > 0 && rec.details.length <= 50) {
    console.warn('\n  Detail:');
    for (const d of rec.details) {
      const what = d.actions.map((a) => a.type).join('+') || 'freeze total';
      console.warn(
        `    ${d.reservation_id}  ${d.status.padEnd(11)} total ${pula(d.total ?? 0)} (${d.total_source}) paid ${pula(d.paid)} → ${what}`
      );
    }
  }

  console.warn(
    APPLY
      ? '\n  ✓ Applied.\n'
      : '\n  Dry run complete — nothing changed. Apply with `npm run db:backfill-invoices:apply`.\n'
  );

  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  await db.destroy();
  process.exit(1);
});
