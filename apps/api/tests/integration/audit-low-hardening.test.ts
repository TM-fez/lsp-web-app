/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit 2026-10-11) Small hardening, through the real app:
 *  - L-6: a form-encoded login (what a cross-site <form> can send) is not accepted;
 *  - L-7: the unauthenticated health checks never echo a raw error.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';

describe('Audit L-6 — no form-encoded login', () => {
  it('refuses a urlencoded body, so a cross-site form cannot sign a browser in', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .type('form')
      .send('email=someone%40lsp.test&password=whatever');
    expect(res.status).toBe(400);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('Audit L-7 — health checks', () => {
  it('report ok without detail when healthy', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('detail');
  });
});
