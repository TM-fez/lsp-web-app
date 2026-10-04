import { describe, it, expect } from 'vitest';
import { pageOf, parsePageQuery, MAX_PAGE_SIZE } from '../../../src/core/http/pagination.js';

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
