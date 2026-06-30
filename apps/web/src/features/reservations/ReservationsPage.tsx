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
import { useProperties } from '@/features/properties/hooks';
import { useReservations } from './hooks';
import { ReservationFormDrawer } from './ReservationFormDrawer';
import { nights, statusTone, statusLabel, fmtDate, sourceLabel, SOURCES } from './util';
import type { Reservation, ReservationStatus, ReservationSource } from '@/types';

const STATUSES: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];

export function ReservationsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('reservations.create');
  const canUpdate = hasPerm('reservations.update');
  const canCancel = hasPerm('reservations.delete');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ReservationStatus>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | ReservationSource>('ALL');
  const [propertyFilter, setPropertyFilter] = useState<'ALL' | string>('ALL');
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
      source: sourceFilter === 'ALL' ? undefined : sourceFilter,
      property_id: propertyFilter === 'ALL' ? undefined : propertyFilter,
    }),
    [search, statusFilter, sourceFilter, propertyFilter],
  );

  const { data, isLoading, isError, isFetching, refetch } = useReservations(params);
  const { data: rooms } = useRooms();
  const { data: properties } = useProperties();
  const reservations = data?.data ?? [];
  const total = data?.total ?? 0;
  const truncated = total > reservations.length;
  const hasQuery =
    search.trim() !== '' || statusFilter !== 'ALL' || sourceFilter !== 'ALL' || propertyFilter !== 'ALL';

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
          <h1 className="font-display text-4xl text-ink">Reservations</h1>
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
          <Select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as 'ALL' | ReservationSource)}
            className="max-w-[12rem]"
          >
            <option value="ALL">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </Select>
          {(properties?.length ?? 0) > 1 && (
            <Select
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              className="max-w-[12rem]"
            >
              <option value="ALL">All properties</option>
              {(properties ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
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
        <div className="flex flex-col gap-3">
          <div className="border-t border-line">
            {reservations.map((r, i) => {
              const n = nights(r.check_in_date, r.check_out_date);
              return (
                <button
                  key={r.id}
                  onClick={() => openRow(r)}
                  className="group relative flex w-full items-center gap-5 overflow-hidden border-b border-line py-4 text-left"
                >
                  <div className="absolute inset-0 origin-bottom scale-y-0 bg-forest transition-transform duration-500 ease-[cubic-bezier(.19,1,.22,1)] group-hover:scale-y-100" />
                  <span className="relative w-6 shrink-0 font-display text-xs italic text-terra">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="relative min-w-0 flex-1">
                    <div className="truncate font-display text-xl text-ink transition-colors duration-500 group-hover:text-cream">
                      {r.guest_name || 'Unnamed guest'}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] uppercase tracking-[0.12em] text-muted transition-colors duration-500 group-hover:text-oncream">
                      {r.room_code ? `${r.room_code}${r.room_name ? ` · ${r.room_name}` : ''}` : 'No unit'} ·{' '}
                      {fmtDate(r.check_in_date)} → {fmtDate(r.check_out_date)} · {n} night{n === 1 ? '' : 's'} ·{' '}
                      {sourceLabel(r.source)}
                    </div>
                  </div>
                  <Badge tone={statusTone[r.status]} className="relative shrink-0">
                    {statusLabel(r.status)}
                  </Badge>
                  <span className="relative w-4 shrink-0 -translate-x-2 font-display text-xl text-terra opacity-0 transition-all duration-500 ease-[cubic-bezier(.19,1,.22,1)] group-hover:translate-x-0 group-hover:text-cream group-hover:opacity-100">
                    →
                  </span>
                </button>
              );
            })}
          </div>
          {truncated && (
            <p className="text-xs text-muted">
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
