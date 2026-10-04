import { AppError } from '../errors/AppError.js';

export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

type Query = Record<string, unknown>;

function whole(raw: unknown, name: string, min: number, max: number): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw AppError.badRequest(
      max === Number.MAX_SAFE_INTEGER
        ? `${name} must be a whole number of ${min} or more.`
        : `${name} must be a whole number from ${min} to ${max}.`,
    );
  }
  return n;
}

/**
 * ?page= & ?limit= for the list endpoints, with ONE rule everywhere (it is the rule
 * /invoices has always had): `limit` is 1–100 and anything outside it is a 400 — not
 * silently clamped, which hid the fact that a caller was only getting part of the data.
 * Absent values fall back to page 1 / 20 rows.
 */
export function parsePageQuery(query: Query): { page: number; limit: number } {
  return {
    page: whole(query.page, 'page', 1, Number.MAX_SAFE_INTEGER) ?? 1,
    limit: whole(query.limit, 'limit', 1, MAX_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE,
  };
}

/**
 * Opt-in paging for the small "everything" lists (users, payroll staff, costs, expenses).
 * No `limit` → every row, exactly as before, so existing callers are unaffected. With
 * `limit` (and optionally `page`) → that slice. `total` is always the full count.
 */
export function pageOf<T>(rows: T[], query: Query): { data: T[]; total: number; page: number; limit: number | null } {
  if (query.limit === undefined && query.page === undefined) {
    return { data: rows, total: rows.length, page: 1, limit: null };
  }
  const { page, limit } = parsePageQuery(query);
  const start = (page - 1) * limit;
  return { data: rows.slice(start, start + limit), total: rows.length, page, limit };
}
