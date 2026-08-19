import { describe, it, expect } from 'vitest';
import { parseCsv, phoneKey, keysOf, chunk } from '../../../src/db/import-guests';

// The guest importer parses its own CSV (no dependency added for it) and decides who is
// "already in the CRM" on a re-run. Both are pure, and both have already been wrong once:
// an early matching rule keyed on the phone alone and silently swallowed 32 people who share
// a number with a partner or colleague. These lock the corrected behaviour in.

describe('parseCsv', () => {
  it('reads a plain table', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps commas and newlines that live inside quotes', () => {
    const rows = parseCsv('name,notes\n"Diale, Letlhogonolo","Source rows: 1, 2\nmerged"\n');
    expect(rows[1]).toEqual(['Diale, Letlhogonolo', 'Source rows: 1, 2\nmerged']);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('name\n"He said ""hi"""\n')[1]).toEqual(['He said "hi"']);
  });

  it('handles CRLF line endings and drops blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps empty trailing fields', () => {
    expect(parseCsv('a,b,c\n1,,\n')[1]).toEqual(['1', '', '']);
  });
});

describe('phoneKey', () => {
  it('treats the local, national and international spellings of one number as equal', () => {
    const local = phoneKey('76255071');
    expect(phoneKey('+267 76 255 071')).toBe(local);
    expect(phoneKey('26776255071')).toBe(local);
  });

  it('is empty for a missing number', () => {
    expect(phoneKey(null)).toBe('');
    expect(phoneKey('')).toBe('');
  });
});

describe('keysOf', () => {
  const abbas = { name: 'Ghulam Abbas', phone: '+27 84 292 7211', email: null };
  const zaheer = { name: 'Zaheer Abbas', phone: '+27 84 292 7211', email: null };

  it('does NOT collide two people who share one phone number', () => {
    const shared = keysOf(abbas).filter((k) => keysOf(zaheer).includes(k));
    expect(shared).toEqual([]);
  });

  it('matches the same person written a different way', () => {
    const again = { name: 'ghulam abbas ', phone: '2784292 7211', email: null };
    expect(keysOf(again).some((k) => keysOf(abbas).includes(k))).toBe(true);
  });

  it('matches on email regardless of case, name or phone', () => {
    const first = { name: 'Collins Masooa', phone: '+27 82 792 3757', email: 'M@icloud.com' };
    const later = { name: 'C Masooa', phone: null, email: 'm@icloud.com' };
    expect(keysOf(later).some((k) => keysOf(first).includes(k))).toBe(true);
  });

  it('keeps two same-named people apart when their numbers differ', () => {
    const one = { name: 'John Smith', phone: '+267 71 111 111', email: null };
    const two = { name: 'John Smith', phone: '+267 72 222 222', email: null };
    expect(keysOf(one).some((k) => keysOf(two).includes(k))).toBe(false);
  });
});

describe('chunk', () => {
  // The importer batches its inserts because one round trip per contact took ten minutes over
  // a slow link and dropped mid-transaction. A silently short last batch would lose guests.
  it('splits evenly and keeps the remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('keeps every item exactly once', () => {
    const items = Array.from({ length: 1341 }, (_, i) => i);
    const batches = chunk(items, 500);
    expect(batches.length).toBe(3);
    expect(batches.flat()).toEqual(items);
  });

  it('returns one batch when the list is smaller than the batch size', () => {
    expect(chunk([1, 2], 500)).toEqual([[1, 2]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunk([], 500)).toEqual([]);
  });
});
