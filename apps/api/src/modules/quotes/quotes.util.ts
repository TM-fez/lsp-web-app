// Shared money + date helpers for the commercial core.
// All money values are INTEGER minor units (thebe; 100 = 1 BWP).

/** Whole nights between two calendar dates (check-out exclusive). */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms =
    Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate()) -
    Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  return Math.round(ms / 86_400_000);
}

/** Tax added on top of a tax-exclusive amount, in basis points (1400 = 14%). */
export function taxExclusive(amount: number, bps: number): number {
  return Math.round((amount * bps) / 10_000);
}

/** Deposit as a whole-thebe percentage of a total. */
export function depositFrom(total: number, pct: number): number {
  return Math.round((total * pct) / 100);
}

/**
 * Split a tax-inclusive total into subtotal + tax (for invoices whose total is
 * fixed, e.g. a deposit slice of a quote total). subtotal + tax === total.
 */
export function splitInclusive(total: number, bps: number): { subtotal: number; tax: number } {
  const subtotal = Math.round((total * 10_000) / (10_000 + bps));
  return { subtotal, tax: total - subtotal };
}
