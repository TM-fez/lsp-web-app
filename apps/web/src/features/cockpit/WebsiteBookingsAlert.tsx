import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Globe, ArrowRight } from 'lucide-react';
import { listReservations } from '@/lib/api/reservations';
import { useAuthStore } from '@/store/auth';
import type { Reservation } from '@/types';

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtRange(checkIn: string, checkOut: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
  const a = new Date(checkIn).toLocaleDateString(undefined, opts);
  const b = new Date(checkOut).toLocaleDateString(undefined, opts);
  return `${a} → ${b}`;
}

// A booking made on the public website lands as a PENDING reservation whose notes
// start with "Website booking" (see api public.service.createBooking). Surfacing
// them here means an online booking never arrives silently on the cockpit — staff
// see a standing queue of online bookings that still need a deposit to confirm
// (or a cancel to release the unit).
const WEBSITE_NOTE_PREFIX = 'Website booking';

export function WebsiteBookingsAlert() {
  const canRead = useAuthStore((s) => s.hasPerm('reservations.read'));

  const { data } = useQuery({
    queryKey: ['cockpit-website-bookings'],
    queryFn: () => listReservations({ status: 'PENDING' }),
    refetchInterval: 20_000,
    enabled: canRead,
  });

  const bookings: Reservation[] = (data?.data ?? [])
    .filter((r) => (r.notes ?? '').startsWith(WEBSITE_NOTE_PREFIX))
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  if (!canRead || bookings.length === 0) return null;

  return (
    <section className="animate-rise rounded-lg border border-terra/30 bg-terra-soft/30 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-terra/20 pb-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-terra text-cream">
            <Globe className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-display text-2xl text-ink">
              {bookings.length} website booking{bookings.length === 1 ? '' : 's'}{' '}
              <span className="italic text-terra">awaiting action</span>
            </h2>
            <p className="text-[12px] text-muted">
              Booked online · pending — take a deposit to confirm, or cancel to release the unit.
            </p>
          </div>
        </div>
        <Link
          to="/reservations"
          className="inline-flex items-center gap-1.5 rounded-[2px] bg-forest px-4 py-2 text-xs tracking-wide text-cream transition-transform hover:scale-[1.03]"
        >
          Review in Reservations <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <ul className="mt-3 flex flex-col">
        {bookings.slice(0, 5).map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-terra/15 py-2.5 last:border-0"
          >
            <span className="font-medium text-ink">{r.guest_name ?? 'Guest'}</span>
            <span className="text-sm text-muted">
              {r.room_name ?? r.room_code ?? 'Unit'} · {fmtRange(r.check_in_date, r.check_out_date)}
            </span>
            <span className="ml-auto text-[11px] uppercase tracking-[0.1em] text-faint">{timeAgo(r.created_at)}</span>
          </li>
        ))}
        {bookings.length > 5 && (
          <li className="pt-2 text-[12px] italic text-muted">+ {bookings.length - 5} more in Reservations…</li>
        )}
      </ul>
    </section>
  );
}
