/**
 * (Round 4) The login gates count FAILED attempts per IP+email, not everything per IP or per email.
 * Before: ten wrong passwords for alice@… from anywhere (or any ten requests from one office
 * address) locked alice out for a minute — even with the right password. Brute force is still capped.
 *
 * Runs the REAL auth router; only the controller's login is replaced by a stand-in that answers
 * 200 for the password "right" and 401 for anything else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../../src/modules/auth/auth.controller.js', async (orig) => ({
  ...(await orig<object>()),
  login: (req: express.Request, res: express.Response) =>
    req.body.password === 'right' ? res.json({ ok: true }) : res.status(401).json({ message: 'Wrong email or password' }),
}));

const MAX = 10;
// Pin the allowance so the test means the same thing whatever a developer's .env says
// (dotenv never overrides a variable that is already set).
process.env.RATE_LIMIT_AUTH_MAX = String(MAX);
process.env.RATE_LIMIT_WINDOW_MS = '60000';

async function appWithFreshLimits() {
  vi.resetModules();
  const { authRouter } = await import('../../../src/modules/auth/auth.routes.js');
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/auth', authRouter);
  return app;
}
const login = (app: express.Express, email: string, password: string, ip: string) =>
  request(app).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password });

let app: express.Express;
beforeEach(async () => { app = await appWithFreshLimits(); });

describe('login rate limit', () => {
  it('lets the real owner in after strangers failed on their email from other addresses', async () => {
    for (let i = 0; i < MAX + 2; i++) {
      const bad = await login(app, 'owner@lsp.local', 'nope', `203.0.113.${i + 10}`);
      expect(bad.status).toBe(401); // each stranger address has its own small allowance
    }
    const real = await login(app, 'owner@lsp.local', 'right', '198.51.100.7');
    expect(real.status).toBe(200);
  });

  it('does not lock a colleague out because someone on the same address failed on a different account', async () => {
    for (let i = 0; i < MAX + 2; i++) await login(app, 'typo@lsp.local', 'nope', '198.51.100.9');
    const ok = await login(app, 'colleague@lsp.local', 'right', '198.51.100.9');
    expect(ok.status).toBe(200);
  });

  it('does not count successful sign-ins against the allowance', async () => {
    for (let i = 0; i < MAX * 3; i++) {
      expect((await login(app, 'busy@lsp.local', 'right', '198.51.100.20')).status).toBe(200);
    }
  });

  it('still locks one IP+email after too many wrong passwords — even the right one is then refused', async () => {
    for (let i = 0; i < MAX; i++) {
      expect((await login(app, 'target@lsp.local', 'nope', '198.51.100.30')).status).toBe(401);
    }
    const locked = await login(app, 'target@lsp.local', 'nope', '198.51.100.30');
    expect(locked.status).toBe(429);
    expect((await login(app, 'target@lsp.local', 'right', '198.51.100.30')).status).toBe(429);
  });

  it('treats the email case-insensitively so changing capitals does not reset the count', async () => {
    for (let i = 0; i < MAX; i++) await login(app, i % 2 ? 'Case@LSP.local' : 'case@lsp.local', 'nope', '198.51.100.40');
    expect((await login(app, ' CASE@lsp.local ', 'nope', '198.51.100.40')).status).toBe(429);
  });

  it('still stops one address spraying passwords across many accounts', async () => {
    let blocked = false;
    for (let i = 0; i < MAX * 6; i++) {
      const r = await login(app, `victim${i}@lsp.local`, 'nope', '198.51.100.50');
      if (r.status === 429) { blocked = true; break; }
    }
    expect(blocked).toBe(true);
  });

  it('still stops a guessing run on one account spread over many addresses', async () => {
    let blocked = false;
    for (let i = 0; i < MAX * 6; i++) {
      const r = await login(app, 'distributed@lsp.local', 'nope', `192.0.2.${i + 1}`);
      if (r.status === 429) { blocked = true; break; }
    }
    expect(blocked).toBe(true);
  });
});
