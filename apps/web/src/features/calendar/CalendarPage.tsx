import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleMinus,
  Plus,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { useRooms } from '@/features/rooms/hooks';
import { useReservation, useReservations } from '@/features/reservations/hooks';
import { ReservationFormDrawer } from '@/features/reservations/ReservationFormDrawer';
import { fmtDate } from '@/features/reservations/util';
import { todayISO } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
import { useCalendar } from './hooks';
import {
  addDays,
  barPlacement,
  bookingLabel,
  bookingTone,
  closureTone,
  dayColumns,
  STATUS_WORDS,
  TONE_CLASS,
  unitTypeLabel,
  VIEW_DAYS,
  type DayColumn,
} from './util';
import type { CalendarBooking, CalendarClosure, CalendarUnit, UnitType } from '@/types';

/** Width of the unit-name column, and the narrowest a night may get before the board scrolls. */
const UNIT_COL = '5.5rem';
const MIN_DAY = '2.75rem';

interface Opened {
  id: string;
  guest_name?: string | null;
  room_code?: string | null;
}

/**
 * (Calendar, 2026-10-06) The front-desk board, laid out like Little Hotelier's — which the
 * team ran on before — so nobody has to learn a new picture: units down the side grouped
 * by type, nights across, one coloured bar per stay. It only draws; every change still goes
 * through the booking drawer and the server's rules, so the board can never offer a night
 * the booking check would refuse.
 */
export function CalendarPage() {
  const navigate = useNavigate();
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('reservations.create');
  const canUpdate = hasPerm('reservations.update');
  const canCancel = hasPerm('reservations.delete');
  const canClose = hasPerm('maintenance.create');

  const today = todayISO();
  const [from, setFrom] = useState(today);
  const [days, setDays] = useState<number>(28);
  const [collapsed, setCollapsed] = useState<Set<UnitType>>(new Set());
  const [opened, setOpened] = useState<Opened | null>(null);
  // A new booking: null = drawer shut; {} = from "+ Reservation"; filled = from an empty square.
  const [creating, setCreating] = useState<{ room_id?: string; check_in_date?: string; check_out_date?: string } | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useCalendar(from, days);
  const { data: rooms } = useRooms();
  const columns = useMemo(() => dayColumns(from, days), [from, days]);

  const groups = useMemo(() => {
    const out: { type: UnitType; units: CalendarUnit[] }[] = [];
    for (const u of data?.units ?? []) {
      const last = out[out.length - 1];
      if (last && last.type === u.type) last.units.push(u);
      else out.push({ type: u.type, units: [u] });
    }
    return out;
  }, [data?.units]);

  const byRoom = useMemo(() => {
    const bookings = new Map<string, CalendarBooking[]>();
    const closures = new Map<string, CalendarClosure[]>();
    for (const b of data?.bookings ?? []) bookings.set(b.room_id, [...(bookings.get(b.room_id) ?? []), b]);
    for (const c of data?.closures ?? []) closures.set(c.room_id, [...(closures.get(c.room_id) ?? []), c]);
    return { bookings, closures };
  }, [data?.bookings, data?.closures]);

  const step = (n: number) => setFrom((f) => addDays(f, n));
  const toggle = (t: UnitType) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-ink">Calendar</h1>
          <p className="text-sm text-slate-500">Every unit and every night at a glance — tap a stay to open it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canClose && (
            <Button
              variant="outline"
              onClick={() => navigate('/maintenance')}
              title="Close a unit for some nights: log a high-priority repair with the dates it is out of use."
            >
              <CircleMinus className="h-4 w-4" /> Room closure
            </Button>
          )}
          {canCreate && (
            <Button variant="primary" onClick={() => setCreating({})}>
              <Plus className="h-4 w-4" /> Reservation
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Nights shown"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-28"
        >
          {VIEW_DAYS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </Select>
        <BookingSearch
          onPick={(r) => {
            setFrom(r.check_in_date.slice(0, 10));
            setOpened({ id: r.id, guest_name: r.guest_name, room_code: r.room_code });
          }}
        />
        <Button variant="outline" onClick={() => setFrom(today)}>
          View today
        </Button>
        <div className="flex items-center overflow-hidden rounded-md border border-line-2 bg-paper">
          <NavButton label={`Back ${days} days`} onClick={() => step(-days)} icon={<ChevronFirst className="h-4 w-4" />} />
          <NavButton label="Back a week" onClick={() => step(-7)} icon={<ChevronsLeft className="h-4 w-4" />} />
          <NavButton label="Back a day" onClick={() => step(-1)} icon={<ChevronLeft className="h-4 w-4" />} />
          <label className="flex items-center gap-1 border-x border-line-2 px-2">
            <CalendarDays className="h-4 w-4 text-muted" />
            <input
              type="date"
              aria-label="First night shown"
              value={from}
              onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && setFrom(e.target.value)}
              className="h-9 bg-transparent text-sm text-ink outline-none"
            />
          </label>
          <NavButton label="Forward a day" onClick={() => step(1)} icon={<ChevronRight className="h-4 w-4" />} />
          <NavButton label="Forward a week" onClick={() => step(7)} icon={<ChevronsRight className="h-4 w-4" />} />
          <NavButton label={`Forward ${days} days`} onClick={() => step(days)} icon={<ChevronLast className="h-4 w-4" />} />
        </div>
        {isFetching && !isLoading && <Spinner className="h-4 w-4 text-slate-400" />}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load the calendar"
          description="The server didn’t answer. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : !data || data.units.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-8 w-8" />}
          title="No units in this property yet"
          description="The calendar has one row per unit. Add this property’s units under Rooms and they’ll appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-paper">
          <div className="overflow-x-auto">
            <div style={{ minWidth: `calc(${UNIT_COL} + ${days} * ${MIN_DAY})` }}>
              <HeaderRow columns={columns} today={data.today} />
              {groups.map((g) => (
                <Fragment key={g.type}>
                  <button
                    type="button"
                    onClick={() => toggle(g.type)}
                    aria-expanded={!collapsed.has(g.type)}
                    className="flex w-full items-center gap-2 border-b border-line bg-cream-2/60 px-3 py-1.5 text-left text-sm font-semibold text-ink"
                  >
                    {collapsed.has(g.type) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {unitTypeLabel(g.type)}
                    <span className="font-normal text-muted">· {g.units.length}</span>
                  </button>
                  {!collapsed.has(g.type) &&
                    g.units.map((u) => (
                      <UnitRow
                        key={u.id}
                        unit={u}
                        columns={columns}
                        today={data.today}
                        bookings={byRoom.bookings.get(u.id) ?? []}
                        closures={byRoom.closures.get(u.id) ?? []}
                        onOpen={(b) => setOpened({ id: b.id, guest_name: b.guest_name, room_code: u.code })}
                        onCreate={
                          canCreate
                            ? (iso) => setCreating({ room_id: u.id, check_in_date: iso, check_out_date: addDays(iso, 1) })
                            : undefined
                        }
                        onRepair={hasPerm('maintenance.read') ? () => navigate('/maintenance') : undefined}
                      />
                    ))}
                </Fragment>
              ))}
            </div>
          </div>
          <Legend />
        </div>
      )}

      {opened && (
        <OpenBooking
          opened={opened}
          roomCode={opened.room_code ?? null}
          onClose={() => setOpened(null)}
          canUpdate={canUpdate}
          canCancel={canCancel}
        />
      )}
      {creating && (
        <ReservationFormDrawer
          open
          onOpenChange={(o) => {
            if (!o) setCreating(null);
          }}
          reservation={null}
          rooms={rooms ?? []}
          initial={creating}
        />
      )}
    </div>
  );
}

function NavButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center text-char hover:bg-cream-2"
    >
      {icon}
    </button>
  );
}

function HeaderRow({ columns, today }: { columns: DayColumn[]; today: string }) {
  return (
    <div className="flex border-b border-line">
      <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-paper" style={{ width: UNIT_COL }} />
      <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((c) => {
          const isToday = c.iso === today;
          return (
            <div
              key={c.iso}
              className={cn(
                'border-r border-line py-1 text-center text-[11px] leading-tight',
                c.weekend && 'bg-cal-weekend',
                isToday && 'bg-terra-soft/50'
              )}
            >
              <div className={cn('font-semibold', isToday ? 'text-terra' : 'text-char')}>{isToday ? 'TODAY' : c.weekday}</div>
              <div className="text-sm text-ink">{c.day}</div>
              <div className="text-muted">{c.month}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface UnitRowProps {
  unit: CalendarUnit;
  columns: DayColumn[];
  today: string;
  bookings: CalendarBooking[];
  closures: CalendarClosure[];
  onOpen: (b: CalendarBooking) => void;
  onCreate?: (iso: string) => void;
  onRepair?: () => void;
}

function UnitRow({ unit, columns, today, bookings, closures, onOpen, onCreate, onRepair }: UnitRowProps) {
  const from = columns[0].iso;
  const days = columns.length;
  return (
    <div className="flex h-11 border-b border-line" data-testid={`unit-row-${unit.code}`}>
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center border-r border-line bg-paper px-3 text-sm font-medium text-ink"
        style={{ width: UNIT_COL }}
        title={unit.building_name ? `${unit.name} · ${unit.building_name}` : unit.name}
      >
        <span className="truncate whitespace-nowrap">{unit.code}</span>
      </div>
      <div className="relative flex-1">
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
          {columns.map((c) => {
            const cls = cn('border-r border-line', c.weekend && 'bg-cal-weekend', c.iso === today && 'bg-terra-soft/30');
            // Only today onwards: a booking can't start in the past.
            return onCreate && c.iso >= today ? (
              <button
                key={c.iso}
                type="button"
                aria-label={`New booking: ${unit.code} from ${fmtDate(c.iso)}`}
                onClick={() => onCreate(c.iso)}
                className={cn(cls, 'hover:bg-forest-soft/60')}
              />
            ) : (
              <div key={c.iso} className={cls} />
            );
          })}
        </div>
        {closures.map((c, i) => {
          const p = barPlacement(c.from, c.to, from, days);
          if (!p) return null;
          const tone = TONE_CLASS[closureTone(c.kind)];
          const body = <span className="truncate px-2 text-xs font-medium">{c.label}</span>;
          const style = barStyle(p);
          const shape = barShape(p);
          return c.kind === 'REPAIR' && onRepair ? (
            <button key={`c${i}`} type="button" title={c.label} onClick={onRepair} style={style} className={cn(shape, tone)}>
              {body}
            </button>
          ) : (
            <div key={`c${i}`} title={c.label} style={style} className={cn(shape, tone)}>
              {body}
            </div>
          );
        })}
        {bookings.map((b) => {
          const p = barPlacement(b.check_in_date, b.check_out_date, from, days);
          if (!p) return null;
          const tone = bookingTone(b.status);
          const label = bookingLabel(b);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onOpen(b)}
              title={`${label} — ${STATUS_WORDS[tone]}, ${fmtDate(b.check_in_date)} to ${fmtDate(b.check_out_date)}${
                b.payment_incomplete ? ' · payment incomplete' : ''
              }`}
              style={barStyle(p)}
              className={cn(barShape(p), TONE_CLASS[tone], 'text-left hover:brightness-95')}
            >
              <span className="flex h-full w-5 shrink-0 items-center justify-center bg-black/15">
                <Search className="h-3 w-3" />
              </span>
              <span className="truncate px-1.5 text-xs font-medium">{label}</span>
              {b.payment_incomplete && (
                <span
                  aria-label="Payment incomplete"
                  className="absolute right-0 top-0 h-0 w-0 border-l-[9px] border-t-[9px] border-l-transparent border-t-cal-unpaid"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function barStyle(p: { left: number; width: number }): CSSProperties {
  return { left: `${p.left * 100}%`, width: `calc(${p.width * 100}% - 2px)` };
}

function barShape(p: { openStart: boolean; openEnd: boolean }): string {
  return cn(
    'absolute bottom-1.5 top-1.5 z-10 flex items-center overflow-hidden shadow-sm',
    !p.openStart && 'rounded-l-md',
    !p.openEnd && 'rounded-r-md'
  );
}

function Legend() {
  const items: { cls: string; label: string }[] = [
    { cls: 'bg-cal-confirmed', label: 'Confirmed' },
    { cls: 'bg-cal-pending', label: 'Provisional' },
    { cls: 'bg-cal-in', label: 'Checked in' },
    { cls: 'bg-cal-out', label: 'Checked out' },
    { cls: 'bg-cal-closed', label: 'Room closure' },
    { cls: 'bg-cal-hold', label: 'Held for a quote' },
  ];
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs text-char">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-3 rounded-sm', i.cls)} /> {i.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="relative h-3 w-3 rounded-sm bg-slate-200">
          <span className="absolute right-0 top-0 h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-cal-unpaid" />
        </span>
        Incomplete payment
      </span>
    </div>
  );
}

/**
 * LH's search box: type a guest, unit or note, pick the stay, and the board jumps to its
 * arrival and opens it. Mounted results only once there is something to look for, so an
 * idle box costs no request.
 */
function BookingSearch({
  onPick,
}: {
  onPick: (r: { id: string; check_in_date: string; guest_name?: string | null; room_code?: string | null }) => void;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div className="relative w-56">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
      <Input
        aria-label="Search bookings"
        placeholder="Search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="pl-8"
      />
      {query.length >= 2 && (
        <SearchResults
          query={query}
          onPick={(r) => {
            setText('');
            setQuery('');
            onPick(r);
          }}
        />
      )}
    </div>
  );
}

function SearchResults({
  query,
  onPick,
}: {
  query: string;
  onPick: (r: { id: string; check_in_date: string; guest_name?: string | null; room_code?: string | null }) => void;
}) {
  const { data, isLoading } = useReservations({ search: query });
  const rows = (data?.data ?? []).filter((r) => r.status !== 'CANCELLED' && r.status !== 'NO_SHOW').slice(0, 8);
  return (
    <div className="absolute left-0 top-10 z-30 w-80 rounded-md border border-line-2 bg-paper p-1 shadow-lg">
      {isLoading ? (
        <div className="flex justify-center p-3">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="p-3 text-sm text-slate-500">No live booking matches “{query}”. Try a surname or a unit code.</p>
      ) : (
        rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onPick(r)}
            className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-cream-2"
          >
            <span className="text-sm text-ink">{r.guest_name ?? 'Guest'}</span>
            <span className="text-xs text-muted">
              {r.room_code ?? '—'} · {fmtDate(r.check_in_date)} → {fmtDate(r.check_out_date)}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

/** Loads the full booking the bar stands for and opens the same drawer as Reservations. */
function OpenBooking({
  opened,
  roomCode,
  onClose,
  canUpdate,
  canCancel,
}: {
  opened: Opened;
  roomCode: string | null;
  onClose: () => void;
  canUpdate: boolean;
  canCancel: boolean;
}) {
  const booking = useReservation(opened.id);
  const { data: rooms } = useRooms();
  if (!booking.data) return null;
  return (
    <ReservationFormDrawer
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      // The by-id read carries no joined names; the board already has them.
      reservation={{
        ...booking.data,
        guest_name: opened.guest_name ?? booking.data.guest_name,
        room_code: roomCode ?? booking.data.room_code,
      }}
      rooms={rooms ?? []}
      canUpdate={canUpdate}
      canCancel={canCancel}
    />
  );
}
