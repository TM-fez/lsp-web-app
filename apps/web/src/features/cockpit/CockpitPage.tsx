import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useCockpitBoard, invalidateBoardKey } from './hooks';
import { TodayRail } from './TodayRail';
import { UnitBoard } from './UnitBoard';
import { HousekeepingQueue } from './HousekeepingQueue';
import { AssignBookingDrawer } from './AssignBookingDrawer';
import { ActivityFeed } from './ActivityFeed';
import { WebsiteBookingsAlert } from './WebsiteBookingsAlert';
import { isAssignable } from './status';
import { summarize } from './board';
import { todayISO } from '@/lib/utils/date';
import type { CockpitUnit } from '@/types';

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function spell(n: number): string {
  return n <= 10 ? NUM[n] : String(n);
}

function Stat({ no, k, value, suffix, foot }: { no: string; k: string; value: number; suffix?: string; foot: string }) {
  return (
    <div className="group relative overflow-hidden border-r border-line px-5 py-6 last:border-r-0">
      <div className="absolute inset-0 origin-bottom scale-y-0 bg-forest transition-transform duration-500 ease-[cubic-bezier(.19,1,.22,1)] group-hover:scale-y-100" />
      <div className="relative">
        <div className="font-display text-xs italic text-terra">( {no} )</div>
        <div className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors duration-500 group-hover:text-oncream">
          {k}
        </div>
        <div className="mt-3 font-display text-5xl text-ink tabnum transition-colors duration-500 group-hover:text-cream">
          {value}
          {suffix && <span className="text-2xl italic text-faint">{suffix}</span>}
        </div>
        <div className="mt-1.5 text-[11px] text-muted transition-colors duration-500 group-hover:text-oncream">{foot}</div>
      </div>
    </div>
  );
}

export function CockpitPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useCockpitBoard();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preselectedRoomId, setPreselectedRoomId] = useState<string | null>(null);

  const summary = useMemo(() => summarize(data?.units ?? []), [data?.units]);
  const assignableUnits = (data?.units ?? []).filter((u) => isAssignable(u.status, u.housekeeping_status));
  const occupancyPct = summary.total ? Math.round((summary.occupied / summary.total) * 100) : 0;

  function openAssign(unit?: CockpitUnit) {
    setPreselectedRoomId(unit?.room_id ?? null);
    setDrawerOpen(true);
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (isError || !data) {
    return <div className="text-sm text-terra">Couldn’t load the cockpit. Check the engine is running.</div>;
  }

  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Gaborone',
  }).format(new Date(`${todayISO()}T12:00:00`));

  return (
    <div className="flex flex-col gap-10">
      <header className="animate-rise flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mb-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" />
            {dateLabel} · Gaborone
          </div>
          <h1 className="font-display text-5xl font-medium uppercase leading-[0.98] tracking-tight text-ink sm:text-6xl">
            The house is
            <br />
            <em className="italic text-terra">{spell(occupancyPct)}</em>{' '}
            <span className="lowercase">percent full.</span>
          </h1>
          <p className="mt-5 max-w-md text-[13px] leading-relaxed text-muted">
            {data.arrivals.length} arrival{data.arrivals.length === 1 ? '' : 's'} on the book today.{' '}
            {summary.needsCleaning} unit{summary.needsCleaning === 1 ? '' : 's'} await housekeeping,{' '}
            {summary.maintenance} in repair.
          </p>
        </div>
        <Button variant="primary" onClick={() => openAssign()} disabled={assignableUnits.length === 0}>
          Assign booking
        </Button>
      </header>

      <WebsiteBookingsAlert />

      <section className="animate-rise d-2 grid grid-cols-2 border-y border-line lg:grid-cols-4">
        <Stat no="01" k="In-house tonight" value={data.in_house.length} foot="currently staying" />
        <Stat no="02" k="Arrivals" value={data.arrivals.length} foot={`${assignableUnits.length} units ready to assign`} />
        <Stat no="03" k="Awaiting clean" value={data.housekeeping_queue.length} foot="in the cleaning queue" />
        <Stat no="04" k="In repair" value={summary.maintenance} foot="units under maintenance" />
      </section>

      <section className="animate-rise d-3">
        <div className="mb-5 flex items-baseline gap-4 border-b border-line pb-3">
          <h2 className="font-display text-3xl text-ink">
            Today’s <em className="italic text-terra">movements</em>
          </h2>
        </div>
        <TodayRail arrivals={data.arrivals} inHouse={data.in_house} departures={data.departures} />
      </section>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-3">
        <div className="animate-rise d-4 xl:col-span-2">
          <UnitBoard units={data.units} onAssign={openAssign} />
        </div>
        <div className="animate-rise d-5">
          <HousekeepingQueue items={data.housekeeping_queue} />
        </div>
      </div>

      <ActivityFeed />

      <AssignBookingDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        rooms={assignableUnits}
        preselectedRoomId={preselectedRoomId}
        onComplete={() => qc.invalidateQueries({ queryKey: invalidateBoardKey() })}
      />
    </div>
  );
}
