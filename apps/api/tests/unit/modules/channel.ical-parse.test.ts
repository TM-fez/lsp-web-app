import { describe, it, expect } from 'vitest';
import { parseIcs } from '../../../src/modules/channel/channel.ical-parse.js';

const ics = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Booking.com//EN', body, 'END:VCALENDAR'].join('\r\n');

describe('parseIcs', () => {
  it('reads an all-day VEVENT with an exclusive DTEND', () => {
    const out = parseIcs(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:abc-123@booking.com',
          'DTSTART;VALUE=DATE:20260701',
          'DTEND;VALUE=DATE:20260705',
          'SUMMARY:CLOSED - Not available',
          'END:VEVENT',
        ].join('\r\n'),
      ),
    );
    expect(out).toHaveLength(1);
    const [e] = out;
    expect(e.uid).toBe('abc-123@booking.com');
    expect(e.start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(e.endExclusive.toISOString()).toBe('2026-07-05T00:00:00.000Z');
    expect(e.cancelled).toBe(false);
  });

  it('defaults to a single night when DTEND is absent', () => {
    const out = parseIcs(ics(['BEGIN:VEVENT', 'UID:one-night', 'DTSTART;VALUE=DATE:20260701', 'END:VEVENT'].join('\r\n')));
    expect(out[0].endExclusive.toISOString()).toBe('2026-07-02T00:00:00.000Z');
  });

  it('flags STATUS:CANCELLED events', () => {
    const out = parseIcs(
      ics(['BEGIN:VEVENT', 'UID:gone', 'DTSTART;VALUE=DATE:20260701', 'STATUS:CANCELLED', 'END:VEVENT'].join('\r\n')),
    );
    expect(out[0].cancelled).toBe(true);
  });

  it('parses a basic UTC DATE-TIME by its calendar day', () => {
    const out = parseIcs(
      ics(['BEGIN:VEVENT', 'UID:dt', 'DTSTART:20260701T140000Z', 'DTEND:20260703T100000Z', 'END:VEVENT'].join('\r\n')),
    );
    expect(out[0].start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(out[0].endExclusive.toISOString()).toBe('2026-07-03T00:00:00.000Z');
  });

  it('unfolds continuation lines without inserting a space (RFC 5545 §3.1)', () => {
    // A fold splits at an arbitrary octet boundary; unfolding strips the continuation's
    // leading space and joins with nothing. Fold mid-token so reconstruction is exact.
    const out = parseIcs(
      ics(['BEGIN:VEVENT', 'UID:fold', 'DTSTART;VALUE=DATE:20260701', 'SUMMARY:Reservation-12', ' 345-confirmed', 'END:VEVENT'].join('\r\n')),
    );
    expect(out[0].summary).toBe('Reservation-12345-confirmed');
  });

  it('skips blocks missing a UID or DTSTART, and handles multiple events', () => {
    const out = parseIcs(
      ics(
        [
          'BEGIN:VEVENT',
          'DTSTART;VALUE=DATE:20260701',
          'END:VEVENT', // no UID → skipped
          'BEGIN:VEVENT',
          'UID:good',
          'DTSTART;VALUE=DATE:20260801',
          'DTEND;VALUE=DATE:20260803',
          'END:VEVENT',
        ].join('\r\n'),
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0].uid).toBe('good');
  });

  it('returns nothing for a feed with no events', () => {
    expect(parseIcs(ics('X-WR-CALNAME:Empty'))).toEqual([]);
  });
});
