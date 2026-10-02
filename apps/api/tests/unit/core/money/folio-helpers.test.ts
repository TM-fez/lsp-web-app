import { describe, it, expect } from 'vitest';
import { describeThebe } from '../../../../src/core/money/folio.js';
import { addDays, computeDueDate } from '../../../../src/modules/invoices/invoices.due.js';
import { InvoiceListQuerySchema } from '../../../../src/modules/invoices/invoices.types.js';

describe('describeThebe — thebe as prose, integer arithmetic only', () => {
  it.each([
    [0, 'P0.00'],
    [5, 'P0.05'],
    [100, 'P1.00'],
    [100_800, 'P1,008.00'],
    [123_456_789, 'P1,234,567.89'],
    [-2_550, '-P25.50'],
  ])('%i → %s', (thebe, text) => {
    expect(describeThebe(thebe)).toBe(text);
  });
});

describe('addDays — calendar arithmetic on YYYY-MM-DD strings (no timezone anywhere)', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-10-02', 7)).toBe('2026-10-09');
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-27', 2)).toBe('2028-02-29'); // leap year
    expect(addDays('2026-10-02', -4)).toBe('2026-09-28');
    expect(addDays('2026-10-02', 0)).toBe('2026-10-02');
  });
});

describe('computeDueDate — the later of issue day and check-in, plus the terms', () => {
  it('uses the issue day for a stay already under way', () => {
    expect(computeDueDate({ issuedOn: '2026-10-02', checkInDay: '2026-09-28', termsDays: 7 })).toBe('2026-10-09');
  });
  it('waits for a future check-in: a guest is not late for a stay that has not started', () => {
    expect(computeDueDate({ issuedOn: '2026-10-02', checkInDay: '2026-12-01', termsDays: 7 })).toBe('2026-12-08');
  });
  it('uses the issue day when there is no booking', () => {
    expect(computeDueDate({ issuedOn: '2026-10-02', termsDays: 14 })).toBe('2026-10-16');
    expect(computeDueDate({ issuedOn: '2026-10-02', checkInDay: null, termsDays: 0 })).toBe('2026-10-02');
  });
  it('defaults the terms from INVOICE_TERMS_DAYS (7)', () => {
    expect(computeDueDate({ issuedOn: '2026-10-02' })).toBe('2026-10-09');
  });
});

describe('GET /invoices query schema — validated, not silently dropped', () => {
  const parse = (q: Record<string, unknown>) => InvoiceListQuerySchema.safeParse(q);

  it('applies defaults', () => {
    const r = parse({});
    expect(r.success && r.data).toMatchObject({ page: 1, limit: 20 });
  });

  it('parses the boolean filters from query-string text', () => {
    const r = parse({ outstanding: 'true', overdue: '1' });
    expect(r.success && r.data).toMatchObject({ outstanding: true, overdue: true });
    const off = parse({ outstanding: 'false', overdue: '0' });
    expect(off.success && off.data).toMatchObject({ outstanding: false, overdue: false });
  });

  it.each([
    [{ outstanding: 'yes' }],
    [{ status: 'BOGUS' }],
    [{ kind: 'NOPE' }],
    [{ property_id: 'not-a-uuid' }],
    [{ quote_id: 'x' }],
    [{ from: '02/10/2026' }],
    [{ to: '2026-10' }],
    [{ page: '0' }],
    [{ limit: '1000' }],
    [{ search: '' }],
  ])('rejects %j (a clean 400, not an ignored filter)', (q) => {
    expect(parse(q).success).toBe(false);
  });

  it('rejects a reversed date range with a message the user can act on', () => {
    const r = parse({ from: '2026-10-10', to: '2026-10-01' });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.errors[0]!.message).toMatch(/"from" date must not be after/);
  });

  it('accepts all the filters together', () => {
    const r = parse({
      status: 'PARTIALLY_PAID', kind: 'BALANCE', outstanding: 'true', search: 'Kgosi',
      from: '2026-10-01', to: '2026-10-31', property_id: '3f1f6a3e-6f2b-4a6e-9a43-0b5a1a1a1a1a',
    });
    expect(r.success).toBe(true);
  });
});
