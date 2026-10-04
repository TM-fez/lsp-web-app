/**
 * (Round 4, N-10) The largest single money amount any form may submit: P1,000,000, in thebe.
 *
 * Money columns are 32-bit integers (max ~P21 million), so an unbounded amount did not just
 * allow a typo like an extra zero — a big enough one crashed the save with a server error and
 * a small enough overshoot quietly poisoned totals. No cost, rate, salary, payment or
 * discount in this business gets near P1 million in one go; a legitimate larger sum can be
 * entered as several lines.
 */
export const MAX_MONEY_THEBE = 100_000_000;
