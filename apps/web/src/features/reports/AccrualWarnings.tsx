import type { AccrualDisclosure } from '@/types';

/**
 * The two honesty warnings that ride every accrual revenue figure (G30).
 *
 * Shared rather than copied, and that is the whole point of the file. These are the
 * disclosures the owner was promised in writing when the accrual decision was taken
 * on 2026-09-07, and they now appear beside two different revenue figures — the P&L
 * on `/reports` and the earned-vs-received view on `/reports/revenue`. Two copies of
 * a promise drift; this project has already been bitten by exactly that (see
 * `HANDOVER.md` §8). One component, both pages, one wording.
 *
 * Each warning renders only when it has something to say, so a clean, fully-agreed,
 * fully-backfilled period shows nothing at all — which is itself the signal.
 */
interface Props {
  disclosure?: AccrualDisclosure;
}

function fullPula(thebe: number): string {
  return `P${(thebe / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AccrualWarnings({ disclosure }: Props) {
  const reconstructed = disclosure?.reconstructed ?? 0;
  const missing = disclosure?.unrecognised_stays ?? 0;

  if (reconstructed <= 0 && missing <= 0) return null;

  return (
    <>
      {reconstructed > 0 && (
        <p className="text-terra">
          {fullPula(reconstructed)} of it ({disclosure!.reconstructed_pct}%) is a{' '}
          <strong className="font-medium">reconstruction</strong>: those stays never had a price agreed on
          the booking, so they were valued at today’s rates. Treat them as an estimate, not a record.
        </p>
      )}

      {missing > 0 && (
        <p className="text-terra">
          {missing.toLocaleString('en')} {missing === 1 ? 'stay is' : 'stays are'} missing from this figure
          entirely — the revenue shown is <strong className="font-medium">understated</strong>. This clears
          once the revenue backfill has been run for the period.
        </p>
      )}
    </>
  );
}
