import { Spinner } from '@/components/ui/spinner';
import { useHeldOnCancelled } from './hooks';

const pula = (thebe: number) =>
  `P${(thebe / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Cancelled / no-show bookings that still hold the guest's money. Read-only on purpose:
 * nothing here refunds anything — it makes sure retained money is seen, then a person
 * decides each case (refund from the booking, or keep with a reason).
 */
export function HeldOnCancelledSection() {
  const { data, isLoading, isError } = useHeldOnCancelled();

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
                  <tr key={r.reservation_id} className="border-b border-line last:border-0 hover:bg-cream-2">
                    <td className="px-4 py-3.5 text-ink">{r.guest_name ?? '—'}</td>
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
    </section>
  );
}
