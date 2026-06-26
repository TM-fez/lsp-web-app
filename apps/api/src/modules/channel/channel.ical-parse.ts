// Minimal RFC 5545 reader for Booking.com-style availability feeds. We need only a few
// properties per VEVENT (UID, DTSTART, DTEND, SUMMARY, STATUS) and only DATE / basic UTC
// DATE-TIME values. Hand-rolled to stay zero-dependency and symmetric with the export
// writer (channel.ical.ts) — and fully unit-testable without a network or DB.

export interface ParsedEvent {
  uid: string;
  start: Date; // DTSTART, as a UTC calendar date
  endExclusive: Date; // DTEND, exclusive (all-day convention); a single night if absent
  summary: string | null;
  cancelled: boolean; // STATUS:CANCELLED
}

// RFC 5545 §3.1 line unfolding: a line break followed by a space or tab is a continuation
// of the previous line. Undo that (and normalise CRLF/CR to LF) before parsing.
function unfold(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const out: string[] = [];
  for (const line of normalized.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

// Split "NAME;PARAM=x:VALUE" into its uppercased NAME and raw VALUE (everything after the
// first colon). The ";..." parameter section is kept out of the name.
function splitLine(line: string): { name: string; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const name = line.slice(0, colon).split(';')[0]!.toUpperCase();
  return { name, value: line.slice(colon + 1) };
}

// Parse a DATE (YYYYMMDD) or basic UTC DATE-TIME (YYYYMMDDTHHMMSSZ). We keep only the
// calendar day at UTC midnight — these feeds are all-day blocks, and our date-only columns
// round-trip the same way (see channel.ical.ts).
function parseIcalDate(value: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

type Draft = { uid?: string; start?: Date; end?: Date; summary?: string; status?: string };

export function parseIcs(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  let cur: Draft | null = null;

  for (const line of unfold(text)) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      // A usable block needs a UID and a start; anything else is skipped, not guessed.
      if (cur?.uid && cur.start) {
        events.push({
          uid: cur.uid,
          start: cur.start,
          endExclusive: cur.end ?? addDays(cur.start, 1), // no DTEND → single night
          summary: cur.summary ?? null,
          cancelled: (cur.status ?? '').toUpperCase() === 'CANCELLED',
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const prop = splitLine(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'UID':
        cur.uid = prop.value.trim();
        break;
      case 'DTSTART': {
        const d = parseIcalDate(prop.value);
        if (d) cur.start = d;
        break;
      }
      case 'DTEND': {
        const d = parseIcalDate(prop.value);
        if (d) cur.end = d;
        break;
      }
      case 'SUMMARY':
        cur.summary = prop.value.trim();
        break;
      case 'STATUS':
        cur.status = prop.value.trim();
        break;
      default:
        break;
    }
  }

  return events;
}
