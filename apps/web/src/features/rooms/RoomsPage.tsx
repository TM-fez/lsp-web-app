import { Fragment, useMemo, useState } from 'react';
import { BedDouble, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { unitHasBookingsMessage } from '@/lib/api/errors';
import { useRooms, useRoomStatusAction, type RoomStatusAction } from './hooks';
import { RoomFormDrawer } from './RoomFormDrawer';
import type { HousekeepingStatus, Room, RoomStatus } from '@/types';

type Tone = 'slate' | 'green' | 'amber' | 'blue' | 'rose' | 'violet';

const roomTone: Record<RoomStatus, Tone> = {
  AVAILABLE: 'green',
  OCCUPIED: 'blue',
  MAINTENANCE: 'amber',
  OUT_OF_SERVICE: 'slate',
};
const hkTone: Record<HousekeepingStatus, Tone> = {
  READY: 'green',
  DIRTY: 'rose',
  CLEANING: 'amber',
  INSPECTED: 'blue',
};
const label = (s: string) => s.replace(/_/g, ' ').toLowerCase();

/** Row actions: never wrap; a comfortable tap target on a phone, the usual size from `sm` up. */
const ACTION = 'min-h-10 whitespace-nowrap sm:min-h-0';

export function RoomsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('rooms.create');
  const canUpdate = hasPerm('rooms.update');
  const canDelete = hasPerm('rooms.delete');

  const { data: rooms, isLoading, isError, refetch } = useRooms();
  const statusAction = useRoomStatusAction();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | RoomStatus>('ALL');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  // (R7 N7-4) The server's "this unit still has bookings ahead" question, waiting for an answer.
  const [closeQuestion, setCloseQuestion] = useState<{ id: string; action: RoomStatusAction; message: string } | null>(null);

  function changeStatus(id: string, action: RoomStatusAction, confirm = false) {
    setCloseQuestion(null);
    statusAction.mutate(confirm ? { id, action, confirm } : { id, action }, {
      onError: (e) => {
        const message = unitHasBookingsMessage(e);
        if (message) setCloseQuestion({ id, action, message });
      },
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rooms ?? []).filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (!q) return true;
      return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    });
  }, [rooms, search, statusFilter]);

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }
  function openEdit(room: Room) {
    setEditing(room);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center flex-wrap gap-3 justify-between">
        <div>
          <h1 className="font-display text-4xl text-ink">Rooms</h1>
          <p className="text-sm text-slate-500">
            {rooms ? `${rooms.length} unit${rooms.length === 1 ? '' : 's'} in inventory` : 'Manage your units'}
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add unit
          </Button>
        )}
      </div>

      {!isLoading && !isError && (rooms?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search code or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | RoomStatus)}
            className="max-w-[12rem]"
          >
            <option value="ALL">All statuses</option>
            <option value="AVAILABLE">Available</option>
            <option value="OCCUPIED">Occupied</option>
            <option value="MAINTENANCE">Maintenance</option>
            <option value="OUT_OF_SERVICE">Out of service</option>
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load units"
          description="The server didn’t respond. Check the API is running and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : (rooms?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<BedDouble className="h-8 w-8" />}
          title="No units yet"
          description="Add your first unit so it can be priced, booked and cleaned. Without a unit, the cockpit has nothing to assign."
          action={
            canCreate ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add your first unit
              </Button>
            ) : (
              <span className="text-xs text-slate-400">Ask an admin for the “rooms.create” permission to add units.</span>
            )
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description="No units match your search or filter. Try clearing them." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          {/* (R5 retest) On a phone (~390 px) the six columns scrolled sideways and clipped their
              headers. Below `sm` the table keeps Unit · Actions; type, capacity, status and
              housekeeping fold under the unit name instead of needing their own columns. */}
          <table className="w-full text-sm sm:min-w-[40rem] sm:whitespace-nowrap md:whitespace-normal">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="w-full px-2.5 py-3 sm:px-4 font-medium sm:w-auto">Unit</th>
                <th className="hidden px-2.5 py-3 sm:px-4 font-medium sm:table-cell">Type</th>
                <th className="hidden px-2.5 py-3 sm:px-4 font-medium sm:table-cell">Cap.</th>
                <th className="hidden px-2.5 py-3 sm:px-4 font-medium sm:table-cell">Status</th>
                <th className="hidden px-2.5 py-3 sm:px-4 font-medium sm:table-cell">Housekeeping</th>
                <th className="px-2.5 py-3 sm:px-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((room) => {
                const pending = statusAction.isPending && statusAction.variables?.id === room.id;
                return (
                  <Fragment key={room.id}>
                  <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-2.5 py-3 sm:px-4">
                      <div className="whitespace-nowrap font-medium text-slate-900">{room.code}</div>
                      <div className="text-xs text-slate-500">{room.name}</div>
                      {room.ownership === 'LANDLORD' && (
                        <div className="mt-0.5 text-[11px] text-amber-700">
                          Landlord{room.landlord_name ? ` · ${room.landlord_name}` : ''}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 sm:hidden">
                        <span className="whitespace-nowrap capitalize">{label(room.type)} · sleeps {room.capacity}</span>
                        <Badge tone={roomTone[room.status]}>{label(room.status)}</Badge>
                        <Badge tone={hkTone[room.housekeeping_status]}>{label(room.housekeeping_status)}</Badge>
                      </div>
                    </td>
                    <td className="hidden px-2.5 py-3 sm:px-4 capitalize text-slate-600 sm:table-cell">{label(room.type)}</td>
                    <td className="hidden px-2.5 py-3 sm:px-4 text-slate-600 sm:table-cell">{room.capacity}</td>
                    <td className="hidden px-2.5 py-3 sm:px-4 sm:table-cell">
                      <Badge tone={roomTone[room.status]}>{label(room.status)}</Badge>
                    </td>
                    <td className="hidden px-2.5 py-3 sm:px-4 sm:table-cell">
                      <Badge tone={hkTone[room.housekeeping_status]}>{label(room.housekeeping_status)}</Badge>
                    </td>
                    <td className="px-2.5 py-3 sm:px-4">
                      {/* (R6 #13) On a phone the status actions looked like plain text, wrapped
                          and were small to tap: outlined, never wrapped, ≥ 40 px tall and
                          stacked one per line below `sm`; a single row from `sm` up. */}
                      <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-1">
                        {canUpdate && pending && <Spinner />}
                        {canUpdate && room.status === 'AVAILABLE' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className={ACTION}
                              disabled={pending}
                              onClick={() => changeStatus(room.id, 'maintenance')}
                            >
                              Maintenance
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className={ACTION}
                              disabled={pending}
                              onClick={() => changeStatus(room.id, 'out-of-service')}
                            >
                              Out of service
                            </Button>
                          </>
                        )}
                        {canUpdate && (room.status === 'MAINTENANCE' || room.status === 'OUT_OF_SERVICE') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className={ACTION}
                            disabled={pending}
                            onClick={() => changeStatus(room.id, 'restore')}
                          >
                            Restore
                          </Button>
                        )}
                        {canUpdate && (
                          <Button size="sm" variant="outline" className={ACTION} onClick={() => openEdit(room)}>
                            Edit
                          </Button>
                        )}
                        {!canUpdate && <span className="text-xs text-slate-400">View only</span>}
                      </div>
                    </td>
                  </tr>
                  {/* (R8 #1) The "still has bookings" question opens right under the unit it is
                      about and names it — at the top of the page it was easy to miss. */}
                  {closeQuestion?.id === room.id && (
                    <tr>
                      <td colSpan={6} className="px-2.5 pb-3 sm:px-4">
                        <div role="alert" className="flex flex-col gap-3 rounded-md border border-terra/40 bg-cream px-4 py-3 text-sm text-char sm:flex-row sm:items-center">
                          <p className="flex-1">
                            <span className="font-medium text-ink">{room.code}:</span> {closeQuestion.message}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => setCloseQuestion(null)}>
                              Keep it open
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => changeStatus(closeQuestion.id, closeQuestion.action, true)}
                            >
                              {closeQuestion.action === 'maintenance' ? 'Put it into maintenance anyway' : 'Take it out of service anyway'}
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <RoomFormDrawer open={drawerOpen} onOpenChange={setDrawerOpen} room={editing} canDelete={canDelete} />
    </div>
  );
}
