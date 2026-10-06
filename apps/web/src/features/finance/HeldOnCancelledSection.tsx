import { useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/auth';
import { useReservation } from '@/features/reservations/hooks';
import { useRooms } from '@/features/rooms/hooks';
import { ReservationFormDrawer } from '@/features/reservations/ReservationFormDrawer';
import { useHeldOnCancelled } from './hooks';

const pula = (thebe: number) =>
  `P${(thebe / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Cancelled / no-show bookings that still hold the guest's money. Read-only on purpose:
 * nothing here refunds anything — it makes sure retained money is seen, then a person
 * decides each case (refund from the booking, or keep with a reason).
 *
 * (R9 #3) Each row opens its booking right here, where the refund lives — staff used to have
 * to find it again under Reservations.
 */
export function HeldOnCancelledSection() {
  const { data, isLoading, isError } = useHeldOnCancelled();
  const [openRow, setOpenRow] = useState<OpenRow | null>(null);

  if (isLoading) return <Spinner />;
  if (isError || !data) {
    return <p className="text-sm text-muted">Couldn’t load cancelled bookings that still hold money.</p>;
  }

  return (
    <section aria-labelledby="held-on-cancelled">
      <h2 id="held-on-cancelled" className="mb-1 font-display text-xl text-ink">Cancelled with money held</h2>
      {data.count === 0 ? (
        <p className="text-sm text-muted">No cancelled bookings are holding guest money.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">
            {data.count} {data.count === 1 ? 'booking' : 'bookings'} · {pula(data.total_held)} held. {data.note}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line bg-paper">
            <table className="min-w-[40rem] whitespace-nowrap md:whitespace-normal w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                  <th className="px-4 py-3.5 font-medium">Guest</th>
                  <th className="px-4 py-3.5 font-medium">Unit</th>
                  <th className="px-4 py-3.5 font-medium">Stay</th>
                  <th className="px-4 py-3.5 font-medium">Status</th>
                  <th className="px-4 py-3.5 text-right font-medium">Held</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.reservation_id}
                    onClick={() => setOpenRow({ id: r.reservation_id, guest_name: r.guest_name, room_code: r.room_code })}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-cream-2"
                  >
                    <td className="px-4 py-3.5 text-ink">
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenRow({ id: r.reservation_id, guest_name: r.guest_name, room_code: r.room_code });
                        }}
                      >
                        {r.guest_name ?? 'Unnamed guest'}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-muted">{r.room_code ?? '—'}</td>
                    <td className="px-4 py-3.5 text-muted">{r.check_in_date} → {r.check_out_date}</td>
                    <td className="px-4 py-3.5 text-muted">{r.status === 'NO_SHOW' ? 'No-show' : 'Cancelled'}</td>
                    <td className="px-4 py-3.5 text-right tabnum text-ink">{pula(r.received)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {openRow && <HeldBookingDrawer row={openRow} onClose={() => setOpenRow(null)} />}
    </section>
  );
}

interface OpenRow {
  id: string;
  guest_name: string | null;
  room_code: string | null;
}

/** Loads the clicked booking (and the units list the drawer needs) only once a row is opened. */
function HeldBookingDrawer({ row, onClose }: { row: OpenRow; onClose: () => void }) {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const booking = useReservation(row.id);
  const { data: rooms } = useRooms();
  if (!booking.data) return null;
  return (
    <ReservationFormDrawer
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      // (R10 #6) The by-id read now carries the unit name, coordinator and bill-to the drawer
      // shows ("DEMO-G2 ·" had nothing after the dot); the row's names are only a fallback.
      reservation={{
        ...booking.data,
        guest_name: booking.data.guest_name ?? row.guest_name ?? undefined,
        room_code: booking.data.room_code ?? row.room_code ?? undefined,
      }}
      rooms={rooms ?? []}
      canUpdate={hasPerm('reservations.update')}
      canCancel={hasPerm('reservations.delete')}
    />
  );
}
