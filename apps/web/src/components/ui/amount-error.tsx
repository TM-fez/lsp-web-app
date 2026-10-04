import { pulaAmountError } from '@/lib/utils/money';

/**
 * The one-line "what's wrong with this amount" under any Pula input — blank when the text
 * is fine or empty. Wording lives in pulaAmountError() so every amount box says the same
 * thing ("Use a dot for decimals, e.g. 10.50"). Pair it with the box's own disabled-submit
 * rule: pulaToThebe() gives NaN for exactly the values this explains.
 */
export function AmountError({ value, className }: { value: string; className?: string }) {
  const message = pulaAmountError(value);
  if (!message) return null;
  return (
    <p role="alert" className={className ?? 'text-[11px] text-terra'}>
      {message}
    </p>
  );
}
