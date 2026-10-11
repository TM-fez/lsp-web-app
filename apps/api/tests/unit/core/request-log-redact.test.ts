import { describe, it, expect } from 'vitest';
import { redactUrl } from '../../../src/core/middleware/requestLog.middleware.js';

// (Audit 2026-10-11, L-8) Logged URLs used to carry a guest's email + confirmation code, the
// QR check-in token and the Booking.com feed token in plain text.
describe('redactUrl', () => {
  it('masks the lookup email and code, and the QR token', () => {
    expect(redactUrl('/api/v1/public/bookings/lookup?code=abc123&email=a%40b.co')).toBe(
      '/api/v1/public/bookings/lookup?code=[redacted]&email=[redacted]'
    );
    expect(redactUrl('/api/v1/public/checkin?token=0f0f-uuid')).toBe('/api/v1/public/checkin?token=[redacted]');
  });

  it('masks the feed token in the path', () => {
    expect(redactUrl('/api/v1/ical/units/2b1d-uuid.ics')).toBe('/api/v1/ical/units/[redacted]');
  });

  it('keeps everything else as it was', () => {
    expect(redactUrl('/api/v1/reservations?page=2&limit=50')).toBe('/api/v1/reservations?page=2&limit=50');
    expect(redactUrl('/api/v1/rooms')).toBe('/api/v1/rooms');
  });
});
