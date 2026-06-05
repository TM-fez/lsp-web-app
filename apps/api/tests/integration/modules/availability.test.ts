import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createAvailabilityRouter } from '../../../../src/modules/availability/availability.routes.js';

const app = express();
app.use(express.json());

// Mock middleware to set req.user for testing
app.use((req, res, next) => {
  (req as any).user = { id: 'test-user-id', role: 'admin', permissions: ['availability.read'] };
  next();
});

app.use('/api/availability', createAvailabilityRouter({} as any));

describe('Availability Integration', () => {
  it('should return 400 for quote with missing range', async () => {
    const res = await request(app)
      .post('/api/availability/quote')
      .send({});
    expect(res.status).toBe(400); 
  });

  it('should return 400 for calendar with inverted dates', async () => {
    const res = await request(app).get('/api/availability/calendar?check_in=2026-10-10&check_out=2026-10-05');
    expect(res.status).toBe(400);
  });
});
