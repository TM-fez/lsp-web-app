import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * CLAUDE.md invariant 7: the MONEY axis (invoices, folio, payments) is separate from
 * AVAILABILITY. Whether a booking holds a room is decided by its `status` alone — an unpaid
 * booking holds it, a part-paid one holds it, a voided invoice releases nothing.
 *
 * The guarantee is structural, so it is asserted structurally: the code that answers
 * "is this room free?" or exports occupancy to a channel must not so much as import or name
 * the money modules. A static check, because the failure it prevents (a join to invoices
 * sneaking into an overlap query) would not show up in any single-booking test — it would
 * show up as a double-booking in production. (CLAUDE.md used to point at a
 * `folio-invariant.test.ts` that did not exist; this is that test.)
 */

const SRC = join(__dirname, '../../../src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Strip comments so prose that EXPLAINS the rule can still name the words. */
const code = (file: string) =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '');

const AVAILABILITY_FILES = [
  ...walk(join(SRC, 'modules/availability')),
  ...walk(join(SRC, 'modules/channel')),
];

const FORBIDDEN = [
  /\binvoices?\b/i,
  /\bfolio/i,
  /payment_intents/,
  /money\/folio/,
  /invoices\.receivable/,
];

describe('money axis ⟂ availability axis (invariant 7)', () => {
  it('finds the availability and channel sources it is guarding', () => {
    // If the directories move, this guard would silently pass on an empty list.
    expect(AVAILABILITY_FILES.length).toBeGreaterThan(5);
  });

  it.each(AVAILABILITY_FILES.map((f) => [relative(SRC, f), f]))('%s never references invoices or the folio', (_rel, file) => {
    const text = code(file as string);
    for (const pattern of FORBIDDEN) {
      expect(text, `${pattern} found in ${_rel}`).not.toMatch(pattern);
    }
  });

  it('the overlap check in ReservationsRepository.checkAvailability does not touch money tables', () => {
    const text = readFileSync(join(SRC, 'modules/reservations/reservations.repository.ts'), 'utf8');
    const start = text.indexOf('async checkAvailability(');
    const end = text.indexOf('async findPaginated(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = code_(text.slice(start, end));
    for (const pattern of FORBIDDEN) expect(body).not.toMatch(pattern);
    // The blacklist that defines "holds the dates" is status-only, and says so.
    expect(body).toMatch(/'status', 'not in', \['CANCELLED', 'CHECKED_OUT', 'NO_SHOW'\]/);
  });

  it('the money helpers are imported only by money-side code', () => {
    const importers = walk(SRC).filter((f) => /core\/money\/folio|invoices\.receivable/.test(readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('import')).join('\n')));
    for (const f of importers) {
      expect(relative(SRC, f)).not.toMatch(/modules\/(availability|channel)\//);
    }
  });
});

function code_(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/ .*$/gm, '');
}
