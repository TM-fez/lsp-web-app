import type { ReactNode } from 'react';
import type { CockpitGuestCard } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { reservationTone } from './status';
import { useCheckIn, useCheckOut } from './hooks';

function GuestRow({ no, card, action }: { no: number; card: CockpitGuestCard; action?: ReactNode }) {
  return (
    <div className="group flex items-center gap-4 border-b border-line py-3 transition-[padding] duration-500 ease-[cubic-bezier(.19,1,.22,1)] last:border-b-0 hover:pl-2">
      <span className="font-display text-xs italic text-terra">{String(no).padStart(2, '0')}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-lg text-ink">{card.guest_name}</div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
          {card.room_code} · {card.check_in_date.slice(5)} → {card.check_out_date.slice(5)}
        </div>
      </div>
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
}: {
  arrivals: CockpitGuestCard[];
  inHouse: CockpitGuestCard[];
  departures: CockpitGuestCard[];
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
