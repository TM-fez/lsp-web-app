/**
 * G30 — one-off: put the nights of every past stay onto the accrual revenue ledger.
 *
 * The nightly sweep (core/scheduler.ts) only reconciles a rolling window around today
 * and only recognises totals that were AGREED and frozen. This is the run that covers
 * everything else: all of history, with live pricing wired in so a stay that never had
 * its total frozen is reconstructed rather than skipped.
 *
 * ⚠️ A reconstructed stay is priced at TODAY's rates, because rate plans have no
 * effective dating. Figures before go-live are a RECONSTRUCTION, not a recovery. The
 * summary below reports them separately, and every such night carries
 * total_source = 'PRICED' in the ledger so the caveat travels with the data.
 *
 * Like purge-test-data, this is MEANT to run against the live database, so the guard
 * is the same: it does NOTHING unless you pass --yes. Without the flag it is a dry run
 * that prints exactly what it would write.
 *
 * Safe to re-run: reconcile() leaves a booking whose ledger already agrees completely
 * alone, so a second pass changes nothing — except where rates have moved since, which
 * restates the reconstructed stays and is the same caveat again.
 *
 * Usage (with DATABASE_URL pointing at the target DB). Both forms work from the repo
 * root or from apps/api. Applying has its OWN script rather than a flag, because
 * `npm run … -- --yes` never reaches us — npm has its own --yes and eats it:
 *   npm run db:backfill-revenue                                    # dry run
 *   npm run db:backfill-revenue:apply                              # apply
 *   npx tsx apps/api/src/db/backfill-revenue.ts --from 2026-01-01  # bound it (from root)
 */
import 'dotenv/config';
import { db } from '../config/db.js';
import { runRevenueBackfill } from '../modules/revenue/revenue.backfill.js';

const args = process.argv.slice(2);
// `--apply` as well as `--yes` because `npm run … -- --yes` never reaches us.
const APPLY = args.includes('--yes') || args.includes('--apply');

function flag(name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Thebe to Pula, for reading. Money is integer minor units everywhere else. */
function pula(thebe: number): string {
  return `P${(thebe / 100).toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const from = flag('--from');
  const toExcl = flag('--to');

  for (const [name, value] of [['--from', from], ['--to', toExcl]] as const) {
    if (value !== undefined && !ISO_DATE.test(value)) {
      console.error(`\n  ${name} must be a date as YYYY-MM-DD (got: ${value ?? ''})\n`);
      process.exitCode = 1;
      await db.destroy();
      return;
    }
  }

  console.warn('\n  G30 — accrual revenue backfill');
  console.warn(`  Mode:   ${APPLY ? 'APPLY — the ledger will be written' : 'DRY RUN — nothing will change'}`);
  console.warn(`  Window: ${from ?? 'the beginning'} → ${toExcl ?? 'the end'} (by stay date)`);
  console.warn('');

  const result = await runRevenueBackfill(db, { dryRun: !APPLY, from, toExcl });

  const row = (label: string, value: string | number) =>
    console.warn(`    ${label.padEnd(34)} ${String(value).padStart(14)}`);

  console.warn(`  ${APPLY ? 'Written' : 'Would write'}:`);
  row('bookings examined', result.reservations_examined);
  row('bookings changed', result.reservations_changed);
  row('nights recognised', result.nights_written);
  row('nights withdrawn', result.nights_superseded);
  row('revenue recognised', pula(result.amount_written));

  // Two different quantities, deliberately labelled apart: how many bookings REST on a
  // reconstructed price (a standing fact about the ledger, true on every re-run), and
  // how much this particular pass wrote from one (zero on a re-run that changed
  // nothing). Collapsing them reads as "269 bookings, 0 nights", which is nonsense.
  if (result.reconstructed > 0) {
    console.warn('\n  ⚠️  Priced by reconstruction at TODAY’s rates — not recovered:');
    row('bookings resting on a guess', result.reconstructed);
    row(`nights ${APPLY ? 'written' : 'to write'} from one`, result.nights_reconstructed);
    row('revenue from those nights', pula(result.amount_reconstructed));
    console.warn(
      '\n      Rate plans have no effective dating, so these stays were priced at the\n' +
      '      rates active right now, not the rates the guest was actually charged.\n' +
      '      They carry total_source = PRICED in the ledger. Say so wherever the\n' +
      '      figures are shown.'
    );
  }

  if (result.unpriced > 0) {
    console.warn('\n  Could not be priced at all — these stays earn nothing:');
    row('bookings', result.unpriced);
    console.warn(
      '\n      A booking whose unit type has no active rate plan cannot be priced by\n' +
      '      any route. Give the type a rate plan, or set the folio total on the\n' +
      '      booking, then run this again.'
    );
  }

  console.warn(
    APPLY
      ? '\n  ✓ Applied.\n'
      : '\n  Dry run complete — nothing changed. Re-run with `--yes` to apply.\n'
  );

  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  await db.destroy();
  process.exit(1);
});
