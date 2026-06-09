import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { useRooms } from '@/features/rooms/hooks';
import { useReservations } from './hooks';
import { ReservationFormDrawer } from './ReservationFormDrawer';
import { nights, statusTone, statusLabel, fmtDate } from './util';
import type { Reservation, ReservationStatus } from '@/types';

const STATUSES: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];
const dash = <span className="text-slate-300">—</span>;

export function ReservationsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('reservations.create');
  const canUpdate = hasPerm('reservations.update');
  const canCancel = hasPerm('reservations.delete');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ReservationStatus>('ALL');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
    }),
    [search, statusFilter],
  );

  const { data, isLoading, isError, isFetching, refetch } = useReservations(params);
  const { data: rooms } = useRooms();
  const reservations = data?.data ?? [];
  const total = data?.total ?? 0;
  const truncated = total > reservations.length;
  const hasQuery = search.trim() !== '' || statusFilter !== 'ALL';

  const countLabel = !data
    ? 'Manage your bookings'
    : hasQuery
      ? `${total} match${total === 1 ? '' : 'es'}`
      : `${total} reservation${total === 1 ? '' : 's'}`;

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }
  function openRow(reservation: Reservation) {
    setEditing(reservation);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Reservations</h1>
          <p className="text-sm text-slate-500">{countLabel}</p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> New reservation
          </Button>
        )}
      </div>

      {!isLoading && !isError && (reservations.length > 0 || hasQuery) && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search guest, unit or notes"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | ReservationStatus)}
            className="max-w-[12rem]"
          >
            <option value="ALL">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
          {isFetching && <Spinner className="h-4 w-4 text-slate-400" />}
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load reservations"
          description="The server didn’t respond. Check the API is running and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : reservations.length === 0 && !hasQuery ? (
        <EmptyState
          icon={<CalendarCheck className="h-8 w-8" />}
          title="No reservations yet"
          description="Create a booking to hold a unit for a guest. It stays pending until payment confirms it."
          action={
            canCreate ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> New reservation
              </Button>
            ) : (
              <span className="text-xs text-slate-400">
                Ask an admin for the “reservations.create” permission to add bookings.
              </span>
            )
          }
        />
      ) : reservations.length === 0 ? (
        <EmptyState title="No matches" description="No reservations match your search or filter. Try clearing them." />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium">Guest</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Stay</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => {
                  const n = nights(r.check_in_date, r.check_out_date);
                  return (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium text-slate-900">{r.guest_name || dash}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {r.room_code ? (
                          <>
                            <span className="font-medium text-slate-700">{r.room_code}</span>
                            {r.room_name ? <span className="text-slate-400"> · {r.room_name}</span> : null}
                          </>
                        ) : (
                          dash
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>
                          {fmtDate(r.check_in_date)} → {fmtDate(r.check_out_date)}
                        </div>
                        <div className="text-xs text-slate-400">
                          {n} night{n === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone[r.status]}>{statusLabel(r.status)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Button size="sm" variant="outline" onClick={() => openRow(r)}>
                            {canUpdate && (r.status === 'PENDING' || r.status === 'CONFIRMED') ? 'Manage' : 'View'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {truncated && (
            <p className="text-xs text-slate-400">
              Showing the first {reservations.length} of {total}. Refine your search to narrow results.
            </p>
          )}
        </div>
      )}

      <ReservationFormDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        reservation={editing}
        rooms={rooms ?? []}
        canUpdate={canUpdate}
        canCancel={canCancel}
      />
    </div>
  );
}
