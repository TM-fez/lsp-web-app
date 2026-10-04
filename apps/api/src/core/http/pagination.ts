import type { Request, Response, NextFunction } from 'express';
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

/**
 * Mounted in front of a small "everything" list (`GET /users`, `/expenses`, …) to give it
 * opt-in paging without touching the module: with no ?limit / ?page nothing changes;
 * with them, the `data` array in the answer is sliced (`pageOf`) and `total` stays the full
 * count. A bad value is refused up front with the same 400 as every other list.
 */
export function optInPaging(req: Request, res: Response, next: NextFunction): void {
  if (req.query['limit'] === undefined && req.query['page'] === undefined) return next();
  try {
    parsePageQuery(req.query);
  } catch (err) {
    return next(err);
  }
  const send = res.json.bind(res);
  res.json = ((body: unknown) => {
    const rows = (body as { data?: unknown } | null)?.data;
    if (res.statusCode < 300 && Array.isArray(rows)) {
      return send({ ...(body as object), ...pageOf(rows, req.query) });
    }
    return send(body);
  }) as Response['json'];
  next();
}
