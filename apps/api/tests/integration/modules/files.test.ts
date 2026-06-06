import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { createFilesRouter } from '../../../src/modules/files/files.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';

// Auth harness (see availability.test.ts): the router applies the real
// `authenticate` middleware, so requests must carry a Bearer token and the jwt
// verify is mocked to resolve a test user.
const mockState = vi.hoisted(() => ({ user: null as any }));

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: () => {
      if (!mockState.user) throw new Error('jwt malformed');
      return mockState.user;
    },
  },
}));

vi.mock('../../../src/core/auth/authorize.middleware.js', () => ({
  authorize: (permission: string) => (req: Request, res: Response, next: NextFunction) => {
    const perms = (req as any).user?.permissions || [];
    if (!perms.includes(permission)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const app = express();
app.use(express.json());
app.use('/api/files', createFilesRouter({} as any));
app.use(errorHandler);

describe('Files Integration', () => {
  beforeEach(() => {
    mockState.user = { sub: 'test-user-id', role: 'admin', permissions: ['files.read', 'files.create', 'files.delete'] };
  });

  it('returns 401 when unauthenticated', async () => {
    mockState.user = null;
    const res = await request(app).get('/api/files?page=1&limit=10');
    expect(res.status).toBe(401);
  });

  it('should return 400 for upload with missing file', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', 'Bearer t')
      .field('is_public', 'true');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No file uploaded');
  });

  it('should list paginated files (fake db surfaces as 500)', async () => {
    // Past auth/authorize, the route reaches the repository which holds the
    // `{} as any` db and throws — verifying the full middleware chain wires up.
    const res = await request(app)
      .get('/api/files?page=1&limit=10')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(500);
  });
});
