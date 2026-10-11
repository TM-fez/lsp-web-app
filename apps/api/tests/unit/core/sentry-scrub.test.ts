import { describe, it, expect } from 'vitest';
import { scrubSentryEvent } from '../../../src/core/sentryScrub.js';

// (Audit 2026-10-11) Checked on a local copy: a crash during login sent the typed email and
// password, the refresh cookie and the access token to Sentry. A report keeps what finds the
// bug and nothing private.
describe('scrubSentryEvent', () => {
  const event = () =>
    ({
      type: undefined,
      request: {
        method: 'POST',
        url: 'https://api.example/api/v1/public/bookings/lookup?code=abc123&email=a%40b.co',
        query_string: 'code=abc123&email=a%40b.co',
        data: '{"email":"guest@example.com","password":"Sup3r$ecret"}',
        cookies: { lsp_refresh: 'SECRET-REFRESH' },
        headers: { authorization: 'Bearer SECRET', Cookie: 'lsp_refresh=SECRET', 'content-type': 'application/json' },
      },
      user: { email: 'guest@example.com', ip_address: '1.2.3.4' },
      exception: { values: [{ type: 'Error', value: 'db down' }] },
    }) as never;

  it('drops the body, cookies, auth header and user', () => {
    const out = scrubSentryEvent(event()) as any;
    expect(out.request.data).toBeUndefined();
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.headers).toEqual({ 'content-type': 'application/json' });
    expect(out.user).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/Sup3r|SECRET|guest@example\.com/);
  });

  it('masks secrets in the URL but keeps the path, and keeps the error itself', () => {
    const out = scrubSentryEvent(event()) as any;
    expect(out.request.url).toBe('https://api.example/api/v1/public/bookings/lookup?code=[redacted]&email=[redacted]');
    expect(out.request.query_string).toBe('code=[redacted]&email=[redacted]');
    expect(out.request.method).toBe('POST');
    expect(out.exception.values[0].value).toBe('db down');
  });
});
