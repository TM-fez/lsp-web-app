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

  // Round 4: Excel ignores leading spaces, so "  =1+1" still calculates; full-width forms too.
  it('neutralises formulas hidden behind leading whitespace', () => {
    expect(csvCell('  =1+1')).toBe("'  =1+1");
    expect(csvCell(' \u00A0+267 71')).toBe("' \u00A0+267 71");
    expect(csvCell('\u200B@SUM(A1)')).toBe("'\u200B@SUM(A1)");
    expect(csvCell(' -5')).toBe("' -5");
  });

  it('neutralises full-width = + - @', () => {
    for (const c of ['\uFF1D', '\uFF0B', '\uFF0D', '\uFF20']) {
      expect(csvCell(`${c}cmd`)).toBe(`'${c}cmd`);
      expect(csvCell(` ${c}cmd`)).toBe(`' ${c}cmd`);
    }
  });

  it('does not touch ordinary text that merely contains those characters', () => {
    expect(csvCell('Anne-Marie')).toBe('Anne-Marie');
    expect(csvCell('  Kgosi + Sons')).toBe('  Kgosi + Sons');
    expect(csvCell('a@b.co')).toBe('a@b.co');
  });

  it('quotes commas, quotes and newlines; leaves plain text alone', () => {
    expect(csvCell('Moeng, Naledi')).toBe('"Moeng, Naledi"');
    expect(csvCell('Kgosi')).toBe('Kgosi');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });
});
