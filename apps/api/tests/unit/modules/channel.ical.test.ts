import { describe, it, expect } from 'vitest';
import { buildCalendar } from '../../../src/modules/channel/channel.ical.js';

// Fast, DB-free checks on the iCalendar serializer itself. The end-to-end "BLOCKED rows
// never appear" guarantee lives in tests/integration/modules/channel-export.test.ts,
// which exercises the real SQL filter.
describe('buildCalendar', () => {
  const sample = buildCalendar({
    calName: 'Lifestyle Apartments — J1 availability',
    dtstamp: new Date('2026-06-26T10:00:00.000Z'),
    events: [
      {
        uid: 'res-1@lsp.lifestyle',
        start: new Date('2026-07-01'),
        endExclusive: new Date('2026-07-05'),
        summary: 'Not available',
      },
    ],
  });

  it('wraps events in a VCALENDAR and terminates with CRLF', () => {
    expect(sample.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(sample.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('emits an all-day VEVENT with an exclusive DTEND (matches our turnover model)', () => {
    expect(sample).toContain('BEGIN:VEVENT\r\n');
    expect(sample).toContain('UID:res-1@lsp.lifestyle');
    expect(sample).toContain('DTSTART;VALUE=DATE:20260701');
    expect(sample).toContain('DTEND;VALUE=DATE:20260705');
    expect(sample).toContain('DTSTAMP:20260626T100000Z');
  });

  it('uses CRLF line endings throughout', () => {
    // Every newline must be a CRLF — no bare LF.
    expect(sample.includes('\n')).toBe(true);
    expect(/[^\r]\n/.test(sample)).toBe(false);
  });

  it('escapes RFC 5545 special characters in text values', () => {
    const ics = buildCalendar({ calName: 'A; B, C\\D', events: [] });
    expect(ics).toContain('X-WR-CALNAME:A\\; B\\, C\\\\D');
  });

  it('produces a valid empty calendar when a unit has no exportable stays', () => {
    const ics = buildCalendar({ calName: 'Empty', events: [] });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});
