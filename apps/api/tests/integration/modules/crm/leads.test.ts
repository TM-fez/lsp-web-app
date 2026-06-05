import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createLeadsRouter } from '../../../../src/modules/crm/leads/leads.routes';

const app = express();
app.use(express.json());

// Mock middleware to set req.user for testing
app.use((req, res, next) => {
  (req as any).user = { id: 'test-user-id', role: 'admin', permissions: ['crm.leads.read', 'crm.leads.create'] };
  (req as any).id = 'test-request-id';
  next();
});

// Assuming a mocked db or test db instance
app.use('/api/crm/leads', createLeadsRouter({} as any)); 

describe('Leads Integration', () => {
  // The router applies `authenticate`, so an unauthenticated request is rejected
  // with 401 before reaching the repository. Full CRUD coverage needs a live DB.
  it('protects the list endpoint — returns 401 without authentication', async () => {
    const res = await request(app).get('/api/crm/leads');
    expect(res.status).toBe(401);
  });
});
