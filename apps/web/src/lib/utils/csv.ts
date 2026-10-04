import { toast } from '@/store/toast';

/**
 * (Round 4) What a spreadsheet may run as a formula: = + - @ (or a tab / carriage return) —
 * also after leading spaces (Excel ignores them: "  =1+1" still calculates), and in their
 * full-width forms ＝ ＋ － ＠ that some versions treat the same way. Zero-width spaces are
 * invisible, so they count as leading blanks too.
 */
const FORMULA_START = /^[\s\u200B-\u200D\u2060\uFEFF]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20\t\r]/;

/**
 * One CSV cell. (Re-test round 3) Guest names, emails and company names are typed by
 * the public; a value starting with = + - @ (or a tab / carriage return) is run as a
 * FORMULA when the file is opened in Excel or Sheets — "CSV injection". Such a value is
 * prefixed with an apostrophe, which spreadsheets show as plain text. Then the usual
 * quoting for commas, quotes and newlines.
 */
export function csvCell(v: string | number | null | undefined): string {
  let s = String(v ?? '');
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Save lines as a .csv and say so — the download used to happen silently, and on some
 * browsers nothing visible changed, so people clicked again. A UTF-8 BOM keeps accented
 * names readable when Excel opens the file.
 */
export function downloadCsv(filename: string, lines: string[]): void {
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast.success(`Saved ${filename}`);
}
