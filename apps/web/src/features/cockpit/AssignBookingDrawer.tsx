import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/store/toast';
import {
  searchContacts,
  createContact,
  createReservation,
  createQuote,
  createHold,
  createPaymentIntent,
  attemptPayment,
} from '@/lib/api/booking';
import type { CockpitUnit, Contact, Quote, Hold, PaymentIntent, PaymentMethod } from '@/types';
import { errMessage } from './hooks';
import { formatMoney, todayISO } from './status';

type Step = 'guest' | 'stay' | 'review' | 'payment' | 'done';

const METHODS: PaymentMethod[] = ['CARD', 'MOBILE_MONEY', 'EFT', 'CASH', 'CORPORATE_CREDIT'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rooms: CockpitUnit[];
  preselectedRoomId?: string | null;
  onComplete: () => void;
}

export function AssignBookingDrawer({ open, onOpenChange, rooms, preselectedRoomId, onComplete }: Props) {
  const [step, setStep] = useState<Step>('guest');
  const [busy, setBusy] = useState(false);

  // Guest
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // Stay
  const [roomId, setRoomId] = useState('');
  const [checkIn, setCheckIn] = useState(todayISO());
  const [checkOut, setCheckOut] = useState(todayISO(1));
  const [guests, setGuests] = useState(1);
  const [method, setMethod] = useState<PaymentMethod>('MOBILE_MONEY');

  // Commercial artifacts
  const [quote, setQuote] = useState<Quote | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);

  // Reset whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    setStep('guest');
    setBusy(false);
    setQuery('');
    setResults([]);
    setContact(null);
    setNewName('');
    setNewPhone('');
    setRoomId(preselectedRoomId ?? rooms[0]?.room_id ?? '');
    setCheckIn(todayISO());
    setCheckOut(todayISO(1));
    setGuests(1);
    setMethod('MOBILE_MONEY');
    setQuote(null);
    setHold(null);
    setIntent(null);
  }, [open, preselectedRoomId, rooms]);

  const selectedRoom = rooms.find((r) => r.room_id === roomId) ?? null;

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toast.error(errMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function doSearch() {
    const list = await run(() => searchContacts(query));
    if (list) setResults(list);
  }

  async function quickCreateGuest() {
    if (!newName.trim()) return;
    const c = await run(() => createContact({ name: newName.trim(), phone: newPhone.trim() || undefined }));
    if (c) {
      setContact(c);
      setStep('stay');
    }
  }

  async function getQuote() {
    if (!selectedRoom) return;
    const q = await run(() =>
      createQuote({ unit_type: selectedRoom.type, check_in: checkIn, check_out: checkOut, guests }),
    );
    if (q) {
      setQuote(q);
      setStep('review');
    }
  }

  async function confirmAndTakeDeposit() {
    if (!contact || !selectedRoom || !quote) return;
    await run(async () => {
      const reservation = await createReservation({
        contact_id: contact.id,
        room_id: selectedRoom.room_id,
        check_in_date: checkIn,
        check_out_date: checkOut,
      });
      const h = await createHold({ quote_id: quote.id, room_id: selectedRoom.room_id, reservation_id: reservation.id });
      const pi = await createPaymentIntent({ hold_id: h.id, method });
      setHold(h);
      setIntent(pi);
      setStep('payment');
    });
  }

  async function settle(outcome: 'SUCCESS' | 'FAILURE') {
    if (!intent) return;
    const pi = await run(() => attemptPayment(intent.id, outcome));
    if (!pi) return;
    setIntent(pi);
    if (pi.status === 'PAID') {
      toast.success('Paid — reservation confirmed');
      setStep('done');
      onComplete();
    } else if (pi.status === 'FAILED') {
      toast.error('Payment failed — hold released');
    } else {
      toast.info(`Payment ${pi.status.toLowerCase()} — you can retry`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a booking</DialogTitle>
          <DialogDescription>
            {selectedRoom ? `${selectedRoom.code} · ${selectedRoom.name}` : 'Pick a ready unit'} · keep it occupied,
            keep it human.
          </DialogDescription>
        </DialogHeader>

        <StepTrail step={step} />

        {step === 'guest' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Find an existing guest</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Search name, email, phone"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                />
                <Button variant="outline" onClick={doSearch} disabled={busy}>
                  Search
                </Button>
              </div>
              <div className="flex flex-col gap-1">
                {results.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setContact(c);
                      setStep('stay');
                    }}
                    className="rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium">{c.name}</span>
                    {c.phone && <span className="text-slate-400"> · {c.phone}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label>…or add a new guest</Label>
              <Input placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input placeholder="Phone (optional)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              <Button variant="outline" onClick={quickCreateGuest} disabled={busy || !newName.trim()}>
                {busy && <Spinner />} Add guest & continue
              </Button>
            </div>
          </div>
        )}

        {step === 'stay' && (
          <div className="flex flex-col gap-4">
            <SummaryLine label="Guest" value={contact?.name ?? '—'} />
            <div className="flex flex-col gap-1">
              <Label>Unit</Label>
              <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                {rooms.map((r) => (
                  <option key={r.room_id} value={r.room_id}>
                    {r.code} · {r.name} ({r.type.toLowerCase()})
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label>Check-in</Label>
                <Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Check-out</Label>
                <Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Guests</Label>
              <Input
                type="number"
                min={1}
                value={guests}
                onChange={(e) => setGuests(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep('guest')}>
                Back
              </Button>
              <Button variant="primary" onClick={getQuote} disabled={busy || !selectedRoom}>
                {busy && <Spinner className="text-white" />} Get quote
              </Button>
            </div>
          </div>
        )}

        {step === 'review' && quote && (
          <div className="flex flex-col gap-4">
            <SummaryLine label="Guest" value={contact?.name ?? '—'} />
            <SummaryLine label="Unit" value={selectedRoom ? `${selectedRoom.code} · ${selectedRoom.name}` : '—'} />
            <SummaryLine label="Nights" value={String(quote.nights)} />
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Total</span>
                <span className="font-medium">{formatMoney(quote.total_amount, quote.currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Tax</span>
                <span>{formatMoney(quote.tax_amount, quote.currency)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm">
                <span className="font-medium text-emerald-700">Deposit due now</span>
                <span className="font-semibold text-emerald-700">{formatMoney(quote.deposit_amount, quote.currency)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Deposit method</Label>
              <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.replace('_', ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep('stay')}>
                Back
              </Button>
              <Button variant="primary" onClick={confirmAndTakeDeposit} disabled={busy}>
                {busy && <Spinner className="text-white" />} Hold unit & take deposit
              </Button>
            </div>
          </div>
        )}

        {step === 'payment' && intent && (
          <div className="flex flex-col gap-4">
            <SummaryLine label="Hold" value={hold ? hold.status : '—'} />
            <div className="rounded-lg border border-slate-200 p-4 text-center">
              <div className="text-xs uppercase tracking-wide text-slate-400">Deposit</div>
              <div className="text-2xl font-semibold">{formatMoney(intent.amount, intent.currency)}</div>
              <div className="mt-1 text-sm text-slate-500">
                via {intent.method.replace('_', ' ').toLowerCase()} ·{' '}
                <Badge tone={intent.status === 'PAID' ? 'green' : 'amber'}>{intent.status.toLowerCase()}</Badge>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                attempt {intent.attempts}/{intent.max_attempts}
              </div>
            </div>
            <p className="text-xs text-slate-500">
              No real gateway — confirm the deposit was received, or simulate a failure to see retry-before-release.
            </p>
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => settle('FAILURE')} disabled={busy}>
                Payment failed
              </Button>
              <Button variant="primary" onClick={() => settle('SUCCESS')} disabled={busy}>
                {busy && <Spinner className="text-white" />} Confirm deposit received
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Badge tone="green">Reservation confirmed</Badge>
            <p className="text-sm text-slate-600">
              {contact?.name} is booked into {selectedRoom?.code}. The unit now shows the guest on the board.
            </p>
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepTrail({ step }: { step: Step }) {
  const order: Step[] = ['guest', 'stay', 'review', 'payment', 'done'];
  const labels: Record<Step, string> = {
    guest: 'Guest',
    stay: 'Stay',
    review: 'Quote',
    payment: 'Pay',
    done: 'Confirmed',
  };
  const current = order.indexOf(step);
  return (
    <div className="flex items-center gap-1 text-xs">
      {order.map((s, i) => (
        <span key={s} className={i <= current ? 'font-medium text-emerald-600' : 'text-slate-300'}>
          {labels[s]}
          {i < order.length - 1 && <span className="px-1 text-slate-300">→</span>}
        </span>
      ))}
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
