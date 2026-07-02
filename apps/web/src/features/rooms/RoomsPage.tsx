import { useMemo, useState } from 'react';
import { BedDouble, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { useRooms, useRoomStatusAction } from './hooks';
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
      <div className="flex items-center justify-between">
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
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Unit</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Cap.</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Housekeeping</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((room) => {
                const pending = statusAction.isPending && statusAction.variables?.id === room.id;
                return (
                  <tr key={room.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{room.code}</div>
                      <div className="text-xs text-slate-500">{room.name}</div>
                      {room.ownership === 'LANDLORD' && (
                        <div className="mt-0.5 text-[11px] text-amber-700">
                          Landlord{room.landlord_name ? ` · ${room.landlord_name}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600">{label(room.type)}</td>
                    <td className="px-4 py-3 text-slate-600">{room.capacity}</td>
                    <td className="px-4 py-3">
                      <Badge tone={roomTone[room.status]}>{label(room.status)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={hkTone[room.housekeeping_status]}>{label(room.housekeeping_status)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canUpdate && pending && <Spinner />}
                        {canUpdate && room.status === 'AVAILABLE' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => statusAction.mutate({ id: room.id, action: 'maintenance' })}
                            >
                              Maintenance
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => statusAction.mutate({ id: room.id, action: 'out-of-service' })}
                            >
                              Out of service
                            </Button>
                          </>
                        )}
                        {canUpdate && (room.status === 'MAINTENANCE' || room.status === 'OUT_OF_SERVICE') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => statusAction.mutate({ id: room.id, action: 'restore' })}
                          >
                            Restore
                          </Button>
                        )}
                        {canUpdate && (
                          <Button size="sm" variant="outline" onClick={() => openEdit(room)}>
                            Edit
                          </Button>
                        )}
                        {!canUpdate && <span className="text-xs text-slate-400">View only</span>}
                      </div>
                    </td>
                  </tr>
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
