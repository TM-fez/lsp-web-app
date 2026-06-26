import { ChannelRepository } from './channel.repository.js';
import { buildCalendar } from './channel.ical.js';
import { icalUid, BUSY_SUMMARY } from './channel.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnitFeed {
  found: boolean;
  filename: string;
  ics: string;
}

export class ChannelService {
  constructor(private readonly repo: ChannelRepository) {}

  // Build one unit's live availability feed from its iCal token. The token may arrive
  // with a trailing ".ics" (that's the URL we hand to Booking.com) — strip it. A bad or
  // unknown token returns found:false so the route can 404 without leaking which tokens
  // exist. Guest data never enters the feed: every busy night is just "Not available".
  async buildUnitFeed(rawToken: string): Promise<UnitFeed> {
    const token = rawToken.replace(/\.ics$/i, '');
    if (!UUID_RE.test(token)) return { found: false, filename: '', ics: '' };

    const room = await this.repo.findRoomByIcalToken(token);
    if (!room) return { found: false, filename: '', ics: '' };

    const stays = await this.repo.findExportableStays(room.id);
    const calName = `Lifestyle Apartments — ${room.code} availability`;

    const ics = buildCalendar({
      calName,
      events: stays.map((s) => ({
        uid: icalUid(s.id),
        start: s.check_in_date,
        endExclusive: s.check_out_date,
        summary: BUSY_SUMMARY,
      })),
    });

    return { found: true, filename: `${room.code}.ics`, ics };
  }
}
