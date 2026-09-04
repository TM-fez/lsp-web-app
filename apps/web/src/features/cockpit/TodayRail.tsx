import type { ReactNode } from 'react';
import type { CockpitGuestCard } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { reservationTone } from './status';
import { sourceLabel } from '@/features/reservations/util';
import { calendarDay, shortDay } from '@/lib/utils/date';
import { useCheckIn, useCheckOut } from './hooks';

// Origins worth flagging on the rail: front desk should instantly see an OTA or
// website guest (different arrival workflow — claim/verify, deposit already paid…).
const FLAGGED_SOURCES = new Set(['BOOKING_COM', 'WEBSITE']);

/** Whole days between two 'YYYY-MM-DD' dates. Both are calendar dates in the
 *  property's timezone, so plain UTC parsing cannot drift them. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.round(ms / 86_400_000);
}

/**
 * "3 days late" — the rail now carries arrivals and departures that are overdue, not
 * only today's, so each row has to say which it is. Without this a guest waiting
 * since Saturday looks exactly like one walking in this minute.
 */
function LateBadge({ days }: { days: number }) {
  if (days <= 0) return null;
  return <Badge tone="rose">{days} day{days === 1 ? '' : 's'} late</Badge>;
}

function GuestRow({ no, card, action, late = 0 }: { no: number; card: CockpitGuestCard; action?: ReactNode; late?: number }) {
  return (
    <div className="group flex items-center gap-4 border-b border-line py-3 transition-[padding] duration-500 ease-[cubic-bezier(.19,1,.22,1)] last:border-b-0 hover:pl-2">
      <span className="font-display text-xs italic text-terra">{String(no).padStart(2, '0')}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-lg text-ink">{card.guest_name}</div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
          {/* shortDay, not slice(5): API dates arrive as ISO timestamps. */}
          {card.room_code} · {shortDay(card.check_in_date)} → {shortDay(card.check_out_date)}
        </div>
      </div>
      <LateBadge days={late} />
      {FLAGGED_SOURCES.has(card.source) && <Badge tone="violet">{sourceLabel(card.source)}</Badge>}
      <Badge tone={reservationTone[card.status]}>{card.status.toLowerCase().replace('_', ' ')}</Badge>
      {action}
    </div>
  );
}

function Column({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-3 border-b border-line pb-2">
        <span className="text-[11px] uppercase tracking-[0.22em] text-muted">{title}</span>
        <span className="font-display text-sm italic text-faint">{count}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function TodayRail({
  arrivals,
  inHouse,
  departures,
  today,
}: {
  arrivals: CockpitGuestCard[];
  inHouse: CockpitGuestCard[];
  departures: CockpitGuestCard[];
  /** The board's own operating day (Africa/Gaborone) — what "late" is measured from. */
  today: string;
}) {
  const checkInM = useCheckIn();
  const checkOutM = useCheckOut();

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      <Column title="Arrivals" count={arrivals.length}>
        {arrivals.length === 0 && <p className="py-3 text-sm text-faint">No arrivals due.</p>}
        {arrivals.map((c, i) => (
          <GuestRow
            key={c.reservation_id}
            no={i + 1}
            card={c}
            late={daysBetween(calendarDay(c.check_in_date), today)}
            action={
              <Button
                size="sm"
                variant="primary"
                disabled={checkInM.isPending}
                onClick={() => checkInM.mutate(c.reservation_id)}
              >
                Check in
              </Button>
            }
          />
        ))}
      </Column>

      <Column title="In-house" count={inHouse.length}>
        {inHouse.length === 0 && <p className="py-3 text-sm text-faint">No one in-house.</p>}
        {inHouse.map((c, i) => (
          <GuestRow key={c.occupancy_id ?? c.reservation_id} no={i + 1} card={c} />
        ))}
      </Column>

      <Column title="Departures" count={departures.length}>
        {departures.length === 0 && <p className="py-3 text-sm text-faint">No departures due.</p>}
        {departures.map((c, i) => (
          <GuestRow
            key={c.occupancy_id ?? c.reservation_id}
            no={i + 1}
            card={c}
            late={daysBetween(calendarDay(c.check_out_date), today)}
            action={
              c.occupancy_id ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={checkOutM.isPending}
                  onClick={() => checkOutM.mutate(c.occupancy_id!)}
                >
                  Check out
                </Button>
              ) : null
            }
          />
        ))}
      </Column>
    </div>
  );
}
