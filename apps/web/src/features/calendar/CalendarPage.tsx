import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { useRooms } from '@/features/rooms/hooks';
import { useReservation, useReservations, useUpdateReservation } from '@/features/reservations/hooks';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/utils/money';
import { ReservationFormDrawer } from '@/features/reservations/ReservationFormDrawer';
import { fmtDate } from '@/features/reservations/util';
import { todayISO } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
import { useCalendar, useMovePreview } from './hooks';
import {
  addDays,
  barPlacement,
  bookingLabel,
  bookingTone,
  closureTone,
  dayColumns,
  STATUS_WORDS,
  TONE_CLASS,
  unitColumnWidth,
  unitTypeLabel,
  VIEW_DAYS,
  DRAGGABLE,
  moveTarget,
  type DayColumn,
  type DragMode,
  type MoveTarget,
} from './util';
import type { CalendarBooking, CalendarClosure, CalendarUnit, UnitType } from '@/types';

/**
 * Width of the unit-name column, and the narrowest a night may get before the board scrolls.
 * (Round 11) The column grows to the longest unit code on the board — a fixed 5.5rem cut
 * "DEMO-B12" to "DEMO-…", and a unit you can't name is a unit you can't book. Set once as a
 * CSS variable on the board so the header spacer and every row agree.
 */
const UNIT_COL = 'var(--unit-col)';
const MIN_DAY = '2.75rem';

/** (Calendar drag) A bar being dragged: where it started, and where it would land now. */
interface Drag {
  booking: CalendarBooking;
  mode: DragMode;
  startX: number;
  dayWidth: number;
  /** Whole days moved so far, and the unit row under the pointer. */
  shift: number;
  roomId: string;
  moved: boolean;
}

interface PendingMove {
  booking: CalendarBooking;
  target: MoveTarget;
}

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

  // (Calendar drag, 2026-10-06) Drag a bar sideways to move the stay, up or down to change unit,
  // or by its right edge to change the leaving day. Nothing is saved on drop: the confirm box
  // asks the server what the move would do (same checks and same price rule as an edit) and
  // only "Move booking" sends the edit. Mouse and pen only — on a phone the board stays
  // tap-to-open, and dates are changed in the booking window.
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  // A drag ends with a click on the bar it started on; that click must not also open it.
  const swallowClick = useRef(false);
  // The listeners below live for the whole drag; they read the latest drag through this.
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const dragging = drag !== null;

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      setDrag((d) => {
        if (!d) return d;
        const shift = Math.round((e.clientX - d.startX) / d.dayWidth);
        const row = d.mode === 'move' ? document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-unit-id]') : null;
        const roomId = row?.dataset.unitId ?? d.roomId;
        const moved = d.moved || Math.abs(e.clientX - d.startX) > 4 || roomId !== d.booking.room_id;
        return shift === d.shift && roomId === d.roomId && moved === d.moved ? d : { ...d, shift, roomId, moved };
      });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d?.moved) {
        // Only the click that ends THIS drag — if the pointer was let go over another row no
        // click reaches the bar, and the flag must not eat the next real one.
        swallowClick.current = true;
        setTimeout(() => {
          swallowClick.current = false;
        }, 0);
        const target = moveTarget(d.booking, d.mode, d.shift, d.roomId);
        if (target) setPendingMove({ booking: d.booking, target });
      }
      setDrag(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [dragging]);

  const startDrag = (e: ReactPointerEvent<HTMLElement>, booking: CalendarBooking, mode: DragMode) => {
    if (!canUpdate || !DRAGGABLE.has(booking.status) || e.pointerType === 'touch' || e.button !== 0) return;
    const track = e.currentTarget.closest<HTMLElement>('[data-track]');
    const width = track?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    e.preventDefault();
    setDrag({ booking, mode, startX: e.clientX, dayWidth: width / days, shift: 0, roomId: booking.room_id, moved: false });
  };
  const ghost = drag?.moved ? moveTarget(drag.booking, drag.mode, drag.shift, drag.roomId) : null;

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
            <div
              style={{
                ['--unit-col' as string]: unitColumnWidth(data.units),
                minWidth: `calc(${UNIT_COL} + ${days} * ${MIN_DAY})`,
              }}
            >
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
                        onOpen={(b) => {
                          if (swallowClick.current) {
                            swallowClick.current = false;
                            return;
                          }
                          setOpened({ id: b.id, guest_name: b.guest_name, room_code: u.code });
                        }}
                        canDrag={canUpdate}
                        onDragStart={startDrag}
                        draggingId={drag?.moved ? drag.booking.id : null}
                        ghost={ghost && ghost.room_id === u.id && drag ? { booking: drag.booking, target: ghost } : null}
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
      {pendingMove && data && (
        <MoveConfirm
          move={pendingMove}
          units={data.units}
          onClose={() => setPendingMove(null)}
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
  canDrag?: boolean;
  onDragStart?: (e: ReactPointerEvent<HTMLElement>, b: CalendarBooking, mode: DragMode) => void;
  /** The bar being dragged (drawn faded where it was). */
  draggingId?: string | null;
  /** Where the dragged bar would land, when that is on this row. */
  ghost?: PendingMove | null;
}

function UnitRow({
  unit, columns, today, bookings, closures, onOpen, onCreate, onRepair, canDrag, onDragStart, draggingId, ghost,
}: UnitRowProps) {
  const from = columns[0].iso;
  const days = columns.length;
  return (
    <div className="flex h-11 border-b border-line" data-testid={`unit-row-${unit.code}`} data-unit-id={unit.id}>
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center border-r border-line bg-paper px-3 text-sm font-medium text-ink"
        style={{ width: UNIT_COL }}
        title={unit.building_name ? `${unit.name} · ${unit.building_name}` : unit.name}
      >
        <span className="whitespace-nowrap">{unit.code}</span>
      </div>
      <div className="relative flex-1" data-track>
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
          const draggable = !!canDrag && DRAGGABLE.has(b.status);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onOpen(b)}
              onPointerDown={draggable ? (e) => onDragStart?.(e, b, 'move') : undefined}
              data-draggable={draggable || undefined}
              title={`${label} — ${STATUS_WORDS[tone]}, ${fmtDate(b.check_in_date)} to ${fmtDate(b.check_out_date)}${
                b.payment_incomplete ? ' · payment incomplete' : ''
              }${b.fully_refunded ? ' · fully refunded' : ''}`}
              data-refunded={b.fully_refunded || undefined}
              style={barStyle(p)}
              className={cn(
                barShape(p),
                TONE_CLASS[tone],
                'text-left hover:brightness-95',
                draggable && 'cursor-grab active:cursor-grabbing',
                draggingId === b.id && 'opacity-40',
                // (Round 11) Fully refunded: faded with a dashed edge, so it doesn't read as paid.
                b.fully_refunded && 'opacity-60 outline-2 -outline-offset-2 outline-dashed outline-ink/50'
              )}
            >
              <span className="flex h-full w-5 shrink-0 items-center justify-center bg-black/15">
                <Search className="h-3 w-3" />
              </span>
              <span className="truncate px-1.5 text-xs font-medium">{label}</span>
              {b.fully_refunded && (
                <Undo2 aria-label="Fully refunded" className="mr-1.5 h-3 w-3 shrink-0" />
              )}
              {b.payment_incomplete && (
                <span
                  aria-label="Payment incomplete"
                  className="absolute right-0 top-0 h-0 w-0 border-l-[9px] border-t-[9px] border-l-transparent border-t-cal-unpaid"
                />
              )}
              {/* Grab the right edge to change the leaving day (LH does the same). */}
              {draggable && !p.openEnd && (
                <span
                  aria-hidden
                  data-resize
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onDragStart?.(e, b, 'resize');
                  }}
                  className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize"
                />
              )}
            </button>
          );
        })}
        {ghost && (() => {
          const p = barPlacement(ghost.target.check_in_date, ghost.target.check_out_date, from, days);
          return p ? (
            <div
              aria-hidden
              data-testid="drag-ghost"
              style={barStyle(p)}
              className={cn(barShape(p), 'pointer-events-none z-20 border-2 border-dashed border-ink/60 bg-ink/10')}
            />
          ) : null;
        })()}
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
      // Since #158 the by-id read carries the joined names too (R10 d); the board's copies are
      // laid over them only so the drawer names the guest and unit exactly as the tapped bar did.
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

/**
 * (Calendar drag) "Move Garth Miller from B2 to D6, 25–27 Oct. Price changes from P2,223 to
 * P2,964 (+P741)." The figures come from the server's preview — the same checks and price rule
 * as the edit — and only "Move booking" sends the edit, which checks and prices again under
 * the booking's lock.
 */
function MoveConfirm({ move, units, onClose }: { move: PendingMove; units: CalendarUnit[]; onClose: () => void }) {
  const preview = useMovePreview(move.booking.id, move.target);
  const update = useUpdateReservation();
  const code = (id: string) => units.find((u) => u.id === id)?.code ?? 'another unit';
  const { booking: b, target: t } = move;
  const unitChanges = t.room_id !== b.room_id;
  const p = preview.data;
  const delta = p && p.current_total != null && p.new_total != null ? p.new_total - p.current_total : null;

  async function confirm() {
    try {
      await update.mutateAsync({
        id: b.id,
        input: {
          ...(unitChanges ? { room_id: t.room_id } : {}),
          check_in_date: t.check_in_date,
          check_out_date: t.check_out_date,
        },
      });
      onClose();
    } catch {
      /* hook surfaces the error toast; the bar stays where it was */
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {bookingLabel(b)}?</DialogTitle>
          <DialogDescription>Nothing changes until you confirm.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <div className="rounded-md border border-line bg-cream-2/40 px-3 py-2.5">
            <div className="text-muted">
              From {code(b.room_id)} · {fmtDate(b.check_in_date)} → {fmtDate(b.check_out_date)}
            </div>
            <div className="font-medium text-ink">
              To {code(t.room_id)} · {fmtDate(t.check_in_date)} → {fmtDate(t.check_out_date)}
            </div>
          </div>

          {preview.isLoading ? (
            <div className="flex items-center gap-2 text-muted">
              <Spinner className="h-4 w-4" /> Checking the unit and the price…
            </div>
          ) : preview.isError || !p ? (
            <p role="alert" className="text-terra">Couldn’t check this move. Close this and try again.</p>
          ) : !p.allowed ? (
            <p role="alert" className="rounded-md border border-terra/40 bg-terra/5 px-3 py-2 text-terra">{p.reason}</p>
          ) : (
            <>
              <p data-testid="move-price" className="text-ink">
                {p.new_total == null
                  ? 'The price can’t be worked out automatically for this unit — check it in the booking afterwards.'
                  : p.total_source === 'PRICED'
                    ? `No price has been agreed on this booking yet — today’s rate for the new stay is ${formatMoney(p.new_total)}.`
                    : delta === 0
                      ? `The agreed price stays ${formatMoney(p.new_total)}.`
                      : `The agreed price changes from ${formatMoney(p.current_total ?? 0)} to ${formatMoney(p.new_total)} (${
                          (delta ?? 0) > 0 ? '+' : '−'
                        }${formatMoney(Math.abs(delta ?? 0))}).`}
              </p>
              {/* (Round 11) The price line says how the PRICE moves; staff also need to know
                  what that means for the guest's money — will they owe, or be owed? */}
              {p.new_total != null && (p.paid_amount > 0 || p.total_source === 'FOLIO') && (
                <p data-testid="move-balance" className={p.new_total === p.paid_amount ? 'text-muted' : 'text-terra'}>
                  {p.new_total > p.paid_amount
                    ? `After the move the guest will owe ${formatMoney(p.new_total - p.paid_amount)}${
                        p.paid_amount > 0 ? ` (${formatMoney(p.paid_amount)} already paid)` : ''
                      }.`
                    : p.new_total < p.paid_amount
                      ? `After the move the guest will be due a refund of ${formatMoney(p.paid_amount - p.new_total)} — they have paid ${formatMoney(p.paid_amount)}.`
                      : 'After the move the stay is paid in full — nothing owed either way.'}
                </p>
              )}
              {p.opens_cleaning_task && (
                <p className="text-muted">The guest is in-house, so {code(b.room_id)} gets a cleaning job when they move.</p>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={update.isPending}>
              {p && !p.allowed ? 'Close' : 'Cancel'}
            </Button>
            {p?.allowed && (
              <Button variant="primary" onClick={confirm} disabled={update.isPending}>
                {update.isPending ? <Spinner className="h-4 w-4" /> : 'Move booking'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
