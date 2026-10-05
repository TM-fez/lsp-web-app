/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R6 NEW-6) GET /marketing/segments/:key/members ignored the shared paging rule:
 * limit=0, limit=abc, limit=5000 and page=0 were all quietly accepted. It takes a limit of
 * 1–2000 (the web exports up to 2000 rows) and a page of 1 or more; anything else is a 400.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createMarketingRouter } from '../../../src/modules/marketing/marketing.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

vi.mock('jsonwebtoken', () => ({ default: { verify: () => ({ sub: '00000000-0000-0000-0000-000000000000', role: 'admin', permissions: ['crm.contacts.read'] }) } }));

const app = express();
app.use(express.json());
app.use('/marketing', createMarketingRouter(db));
app.use(errorHandler);
const get = (q: string) => request(app).get(`/marketing/segments/vip/members${q}`).set('Authorization', 'Bearer t');

describe('segment members paging', () => {
  it.each(['?limit=0', '?limit=abc', '?limit=5000', '?page=0', '?page=-1'])('refuses %s with a 400', async (q) => {
    expect((await get(q)).status).toBe(400);
  });

  it('accepts the defaults and the 2000-row export', async () => {
    expect((await get('')).status).toBe(200);
    expect((await get('?limit=2000')).status).toBe(200);
  });
});
