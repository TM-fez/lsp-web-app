import { toast } from '@/store/toast';

/**
 * One CSV cell. (Re-test round 3) Guest names, emails and company names are typed by
 * the public; a value starting with = + - @ (or a tab / carriage return) is run as a
 * FORMULA when the file is opened in Excel or Sheets — "CSV injection". Such a value is
 * prefixed with an apostrophe, which spreadsheets show as plain text. Then the usual
 * quoting for commas, quotes and newlines.
 */
export function csvCell(v: string | number | null | undefined): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
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
