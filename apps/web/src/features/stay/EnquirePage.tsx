import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { LifestyleMark } from '@/components/brand/LifestyleMark';
import { errMessage } from '@/lib/api/errors';
import { submitEnquiry, type EnquirySource } from '@/lib/api/public';

/**
 * Phase 5 — public enquiry form (/enquire). Files a NEW lead automatically so a
 * website/WhatsApp enquiry is always tracked. `?src=whatsapp` tags the channel for
 * a click-to-chat link; anything else defaults to WEBSITE.
 */
export function EnquirePage() {
  const [params] = useSearchParams();
  const source: EnquirySource = params.get('src')?.toLowerCase() === 'whatsapp' ? 'WHATSAPP' : 'WEBSITE';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const valid = name.trim().length > 0 && message.trim().length > 0;

  async function submit() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const { reference: ref } = await submitEnquiry({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        message: message.trim(),
        source,
      });
      setReference(ref);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
        <div className="flex items-center gap-3">
          <LifestyleMark />
          <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Make an enquiry</span>
        </div>

        {reference ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <p className="font-display text-xl text-slate-900">Thank you — we’ve got your enquiry.</p>
            <p className="mt-1 text-sm text-slate-600">
              Our team will be in touch shortly. Your reference is <b>{reference}</b> — quote it when we follow up.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-xl border border-slate-200 p-6 shadow-sm">
            <p className="text-sm text-slate-600">Tell us what you’re looking for and we’ll get right back to you.</p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="eq-name">Your name</Label>
              <Input id="eq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Naledi Moeng" disabled={submitting} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="eq-email">Email (optional)</Label>
                <Input id="eq-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" disabled={submitting} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="eq-phone">Phone (optional)</Label>
                <Input id="eq-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+267 …" disabled={submitting} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="eq-msg">What do you need?</Label>
              <textarea
                id="eq-msg"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="e.g. A 2-bed apartment for 3 weeks in August, near the CBD"
                disabled={submitting}
                className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              />
            </div>
            <Button variant="primary" disabled={submitting || !valid} onClick={submit}>
              {submitting && <Spinner className="text-white" />} Send enquiry
            </Button>
            {error && <p className="text-sm text-rose-600">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
