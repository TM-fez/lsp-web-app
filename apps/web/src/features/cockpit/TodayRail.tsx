import type { ReactNode } from 'react';
import type { CockpitGuestCard } from '@/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { reservationTone } from './status';
import { useCheckIn, useCheckOut } from './hooks';

function GuestRow({ card, action }: { card: CockpitGuestCard; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900">{card.guest_name}</div>
        <div className="text-xs text-slate-500">
          {card.room_code} · {card.check_in_date.slice(5)} → {card.check_out_date.slice(5)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={reservationTone[card.status]}>{card.status.toLowerCase().replace('_', ' ')}</Badge>
        {action}
      </div>
    </div>
  );
}

function Column({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} <span className="text-slate-400">({count})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Column title="Arrivals" count={arrivals.length}>
        {arrivals.length === 0 && <p className="text-sm text-slate-400">No arrivals due.</p>}
        {arrivals.map((c) => (
          <GuestRow
            key={c.reservation_id}
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
        {inHouse.length === 0 && <p className="text-sm text-slate-400">No one in-house.</p>}
        {inHouse.map((c) => (
          <GuestRow key={c.occupancy_id ?? c.reservation_id} card={c} />
        ))}
      </Column>

      <Column title="Departures" count={departures.length}>
        {departures.length === 0 && <p className="text-sm text-slate-400">No departures due.</p>}
        {departures.map((c) => (
          <GuestRow
            key={c.occupancy_id ?? c.reservation_id}
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
