// Minimal RFC 5545 (iCalendar) writer — just enough for per-unit availability feeds.
// All-day VEVENTs only (DATE values, no times). Hand-rolled by design: the export is a
// handful of fixed fields, so a dependency here would be all surface area and no payoff.
// (Import is the opposite — that side uses a real parser.)

export interface CalendarEvent {
  uid: string; // stable, globally-unique id for this booking
  start: Date; // check-in  (inclusive)
  endExclusive: Date; // check-out (exclusive — matches our '[)' booking / turnover model)
  summary: string;
}

export interface CalendarSpec {
  calName: string;
  events: CalendarEvent[];
  dtstamp?: Date; // overridable so tests are deterministic; defaults to now
}

const CRLF = '\r\n';
const MAX_OCTETS = 75;

// VALUE=DATE is YYYYMMDD. check_in/out are date-only columns; node-postgres parses a
// `date` to a JS Date at LOCAL midnight, so reading the LOCAL components gives the
// calendar day back on any server timezone. (Using UTC components drifts a day earlier
// whenever the process timezone is ahead of UTC — e.g. a non-UTC dev box.)
function toICalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// UTC timestamp form YYYYMMDDTHHMMSSZ for DTSTAMP.
function toICalStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// RFC 5545 §3.3.11 — escape backslash, semicolon, comma, and newlines in TEXT values.
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1 — content lines longer than 75 octets are folded onto continuation
// lines that begin with a single space. (ASCII here, so octets == chars.)
function foldLine(line: string): string {
  if (line.length <= MAX_OCTETS) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    out.push((i === 0 ? '' : ' ') + line.slice(i, i + MAX_OCTETS - 1));
    i += MAX_OCTETS - 1;
  }
  return out.join(CRLF);
}

export function buildCalendar(spec: CalendarSpec): string {
  const dtstamp = toICalStamp(spec.dtstamp ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lifestyle Apartments//LSP Channel Sync//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${escapeText(spec.calName)}`),
  ];

  for (const ev of spec.events) {
    lines.push(
      'BEGIN:VEVENT',
      foldLine(`UID:${escapeText(ev.uid)}`),
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${toICalDate(ev.start)}`,
      `DTEND;VALUE=DATE:${toICalDate(ev.endExclusive)}`,
      foldLine(`SUMMARY:${escapeText(ev.summary)}`),
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join(CRLF) + CRLF; // RFC 5545: file ends with a CRLF
}
