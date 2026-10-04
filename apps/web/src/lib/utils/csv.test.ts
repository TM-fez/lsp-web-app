import { describe, it, expect, vi } from 'vitest';

vi.mock('@/store/toast', () => ({ toast: { success: vi.fn() } }));
import { csvCell } from './csv';

describe('csvCell', () => {
  // Re-test 3: guest-typed text starting with = + - @ ran as a formula in Excel.
  it('neutralises values a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+267 71 000 000')).toBe("'+267 71 000 000");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-1')).toBe("'-1");
  });

  it('quotes commas, quotes and newlines; leaves plain text alone', () => {
    expect(csvCell('Moeng, Naledi')).toBe('"Moeng, Naledi"');
    expect(csvCell('Kgosi')).toBe('Kgosi');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });
});
