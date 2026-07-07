import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { LifestyleMark } from '@/components/brand/LifestyleMark';
import { errMessage } from '@/lib/api/errors';
import { getCheckinInfo, submitCheckin, type GuestCheckinInfo } from '@/lib/api/public';

const fmt = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Phase 5 — in-apartment QR self check-in (/stay/checkin?t=<token>). No login:
 * the per-unit token IS the key. The guest confirms their own name/email/phone,
 * which enriches the stay's CRM contact (turning an OTA guest into a direct one).
 */
export function GuestCheckinPage() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';

  const [info, setInfo] = useState<GuestCheckinInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(token));

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    (async () => {
      try {
        const data = await getCheckinInfo(token);
        if (live) setInfo(data);
      } catch (err) {
        if (live) setLoadError(errMessage(err));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [token]);

  async function submit() {
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitCheckin({ token, name: name.trim(), email: email.trim(), phone: phone.trim() || undefined });
      setDone(true);
    } catch (err) {
      setSubmitError(errMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const alreadyDone = done || info?.already_checked_in;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
        <div className="flex items-center gap-3">
          <LifestyleMark />
          <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Guest check-in</span>
        </div>

        {!token ? (
          <p className="text-sm text-slate-600">Please scan the QR code in your apartment to check in.</p>
        ) : loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : loadError ? (
          <p className="text-sm text-rose-600">{loadError}</p>
        ) : info && (
          <>
            <div>
              <h1 className="font-display text-3xl text-slate-900">Welcome to {info.unit_name}</h1>
              <p className="mt-1 text-sm text-slate-600">
                {info.property_name}
                {info.check_out_date && <> · checkout {fmt(info.check_out_date)}</>}
              </p>
            </div>

            {!info.has_stay ? (
              <p className="text-sm text-slate-600">
                We don’t have an active stay for this apartment right now. If you’ve just arrived, please check with the front desk.
              </p>
            ) : alreadyDone ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
                <p className="font-display text-xl text-slate-900">You’re all set — thank you!</p>
                <p className="mt-1 text-sm text-slate-600">
                  We have your details. Enjoy your stay at {info.property_name}, and book direct with us next time for our best rate.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 p-6 shadow-sm">
                <p className="text-sm text-slate-600">Please confirm your details so we can look after your stay.</p>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="ci-name">Full name</Label>
                  <Input id="ci-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Naledi Moeng" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="ci-email">Email</Label>
                  <Input id="ci-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="ci-phone">Phone (optional)</Label>
                  <Input id="ci-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+267 …" />
                </div>
                <Button variant="primary" disabled={submitting || !name.trim() || !email.trim()} onClick={submit}>
                  {submitting && <Spinner className="text-white" />} Confirm my details
                </Button>
                {submitError && <p className="text-sm text-rose-600">{submitError}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
