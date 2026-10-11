/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit 2026-10-11, L-9) Every marketing campaign / strategy request is a paid language-model
 * call, and only the global per-IP limit stood in front of them. They are now limited per
 * person — one user's loop must not lock anyone else out.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createMarketingRouter } from '../../../src/modules/marketing/marketing.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ sub: '00000000-0000-0000-0000-0000000000a1' }));
vi.mock('jsonwebtoken', () => ({
  default: { verify: () => ({ sub: mockState.sub, role: 'admin', permissions: ['reports.read'] }) },
}));

const app = express();
app.use(express.json());
app.use('/marketing', createMarketingRouter(db));
app.use(errorHandler);
const strategy = () => request(app).get('/marketing/strategy').set('Authorization', 'Bearer t');

describe('Audit L-9 — paid AI drafts are limited per person', () => {
  it('stops one person after 20 an hour, without stopping anyone else', async () => {
    for (let i = 0; i < 20; i++) expect((await strategy()).status).not.toBe(429);
    expect((await strategy()).status).toBe(429);
    mockState.sub = '00000000-0000-0000-0000-0000000000a2';
    expect((await strategy()).status).not.toBe(429);
  });
});
