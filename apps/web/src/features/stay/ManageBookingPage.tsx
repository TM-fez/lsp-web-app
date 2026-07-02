import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { LifestyleMark } from '@/components/brand/LifestyleMark';
import { errMessage } from '@/lib/api/errors';
import { lookupBooking, type PublicBookingSummary } from '@/lib/api/public';

const STATUS_COPY: Record<PublicBookingSummary['status'], string> = {
  PENDING: 'Received — our team will confirm it shortly.',
  CONFIRMED: 'Confirmed — we look forward to hosting you.',
  CHECKED_IN: 'You are checked in. Enjoy your stay!',
  CHECKED_OUT: 'Completed — thank you for staying with us.',
  CANCELLED: 'Cancelled. If this is unexpected, please contact us.',
};

const fmt = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * H6 — public "manage my booking" page. Linked from the confirmation email
 * (/stay/manage?code=…&email=…). No login: the code + email pair IS the key.
 */
export function ManageBookingPage() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [booking, setBooking] = useState<PublicBookingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function find(c = code, e = email) {
    if (!c.trim() || !e.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setBooking(await lookupBooking(c.trim(), e.trim()));
    } catch (err) {
      setBooking(null);
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Arriving from the email link: look the booking up straight away. Runs once on
  // mount by design — the params are the initial state, not a reactive dependency.
  useEffect(() => {
    if (params.get('code') && params.get('email')) void find(params.get('code')!, params.get('email')!);
  }, []); // eslint-disable-line

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
        <div className="flex items-center gap-3">
          <LifestyleMark />
          <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Manage your booking</span>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex flex-col gap-1">
            <Label htmlFor="mb-code">Confirmation code</Label>
            <Input id="mb-code" placeholder="LSP-1A2B3C" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="mb-email">Email used for the booking</Label>
            <Input id="mb-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button variant="primary" disabled={loading || !code.trim() || !email.trim()} onClick={() => find()}>
            {loading && <Spinner className="text-white" />} Find my booking
          </Button>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        {booking && (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-xl">{booking.unit_name}</span>
              <span className="font-mono text-sm text-slate-500">{booking.confirmation_code}</span>
            </div>
            <p className="text-sm text-slate-600">
              {fmt(booking.check_in)} → {fmt(booking.check_out)} · {booking.unit_type}
            </p>
            <p className="text-sm">
              <span className="font-semibold">{booking.status.charAt(0) + booking.status.slice(1).toLowerCase().replace('_', ' ')}.</span>{' '}
              {STATUS_COPY[booking.status]}
            </p>
            <p className="text-xs text-slate-500">
              Need to change dates or have a question? Call or WhatsApp the front desk and quote your code.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
