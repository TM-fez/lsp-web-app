import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createReservationsRouter } from '../../../../src/modules/reservations/reservations.routes';

const app = express();
app.use(express.json());

// Mock middleware to set req.user for testing
app.use((req, res, next) => {
  (req as any).user = { id: 'test-user-id', role: 'admin', permissions: ['reservations.read', 'reservations.create'] };
  (req as any).id = 'test-request-id';
  next();
});

// Assuming a mocked db or test db instance
app.use('/api/reservations', createReservationsRouter({} as any)); 

describe('Reservations Integration', () => {
  it('should return 400 for checkAvailability when missing query params', async () => {
    const res = await request(app).get('/api/reservations/availability');
    expect(res.status).toBe(400); 
    expect(res.body.error).toBe('Missing required query params');
  });

  it('should return 500 when db is not injected correctly (mock test)', async () => {
    const res = await request(app).get('/api/reservations');
    expect(res.status).toBe(500); 
  });
});
