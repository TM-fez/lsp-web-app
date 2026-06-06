import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useCockpitBoard, invalidateBoardKey } from './hooks';
import { TodayRail } from './TodayRail';
import { UnitBoard } from './UnitBoard';
import { HousekeepingQueue } from './HousekeepingQueue';
import { AssignBookingDrawer } from './AssignBookingDrawer';
import { isAssignable } from './status';
import type { CockpitUnit } from '@/types';

export function CockpitPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useCockpitBoard();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preselectedRoomId, setPreselectedRoomId] = useState<string | null>(null);

  const assignableUnits = (data?.units ?? []).filter((u) => isAssignable(u.status, u.housekeeping_status));

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
    return <div className="text-sm text-rose-600">Couldn’t load the cockpit. Check the API is running.</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Operations Cockpit</h1>
          <p className="text-sm text-slate-500">
            {data.date} · {assignableUnits.length} unit{assignableUnits.length === 1 ? '' : 's'} ready to assign
          </p>
        </div>
        <Button variant="primary" onClick={() => openAssign()} disabled={assignableUnits.length === 0}>
          Assign booking
        </Button>
      </div>

      <TodayRail arrivals={data.arrivals} inHouse={data.in_house} departures={data.departures} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <UnitBoard units={data.units} onAssign={openAssign} />
        </div>
        <HousekeepingQueue items={data.housekeeping_queue} />
      </div>

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
