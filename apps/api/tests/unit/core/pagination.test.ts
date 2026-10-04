import { describe, it, expect } from 'vitest';
import { pageOf, parsePageQuery, MAX_PAGE_SIZE, parseLimit } from '../../../src/core/http/pagination.js';

describe('parsePageQuery', () => {
  it('defaults to page 1, 20 per page', () => {
    expect(parsePageQuery({})).toMatchObject({ page: 1, limit: 20 });
  });
  it('accepts the maximum and refuses one more', () => {
    expect(parsePageQuery({ limit: String(MAX_PAGE_SIZE) }).limit).toBe(MAX_PAGE_SIZE);
    expect(() => parsePageQuery({ limit: String(MAX_PAGE_SIZE + 1) })).toThrow(/limit/i);
  });
  it.each(['0', '-1', '1.5', 'abc'])('refuses limit=%j', (v) => {
    expect(() => parsePageQuery({ limit: v })).toThrow();
  });
  it('refuses page=0', () => {
    expect(() => parsePageQuery({ page: '0' })).toThrow(/page/i);
  });
});

describe('pageOf', () => {
  const rows = [1, 2, 3, 4, 5];
  it('returns everything when no paging is asked for', () => {
    expect(pageOf(rows, {})).toEqual({ data: rows, total: 5, page: 1, limit: null });
  });
  it('slices when asked', () => {
    expect(pageOf(rows, { limit: '2', page: '3' })).toEqual({ data: [5], total: 5, page: 3, limit: 2 });
  });
});

// (R5 retest) The feeds that take only ?limit refuse out-of-range values instead of clamping.
describe('parseLimit', () => {
  it('falls back when absent, accepts the range, refuses outside it', () => {
    expect(parseLimit({}, 30, 50)).toBe(30);
    expect(parseLimit({ limit: '50' }, 30, 50)).toBe(50);
    expect(() => parseLimit({ limit: '51' }, 30, 50)).toThrow(/1 to 50/);
    expect(() => parseLimit({ limit: '0' }, 30, 50)).toThrow();
    expect(() => parseLimit({ limit: 'abc' }, 30, 50)).toThrow();
  });
});
