import { useEffect, useMemo, useState } from 'react';
import {
  Headphones, ShieldCheck, Wifi, Car, Star, MapPin, Sparkles, Zap, Maximize2,
  Waves, Trees, Wind, Phone, Mail, Facebook, Instagram, ArrowRight,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { LifestyleMark } from '@/components/brand/LifestyleMark';
import { formatMoney } from '@/lib/utils/money';
import { todayISO } from '@/lib/utils/date';
import { isValidEmail } from '@/lib/utils/validation';
import { errMessage } from '@/lib/api/errors';
import { getStayInfo, createBooking, type StayUnitOption, type BookingConfirmation } from '@/lib/api/public';

const UNIT_PHOTOS = ['/stay/living.jpg', '/stay/bedroom.jpg', '/stay/lounge.jpg', '/stay/interior2.jpg'];
const UNIT_BLURB: Record<string, string> = {
  STANDARD: 'Perfect for business & solo travellers',
  DELUXE: 'Comfortable space. Work. Relax. Reset.',
  SUITE: 'Room for family, colleagues & longer stays',
  CONFERENCE: 'Meet, host and present in comfort',
  CUSTOM: 'A bespoke layout for your stay',
};
const unitLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });

const HERO_FEATURES = [
  { icon: Headphones, label: '24/7', sub: 'Support' },
  { icon: ShieldCheck, label: 'Secure', sub: 'Access' },
  { icon: Wifi, label: 'Fast', sub: 'WiFi' },
  { icon: Car, label: 'Free', sub: 'Parking' },
];
const WHY = [
  { icon: Maximize2, label: 'Spacious', sub: 'Fully furnished apartments' },
  { icon: MapPin, label: 'Prime', sub: 'Quiet, central locations' },
  { icon: Sparkles, label: 'Serviced', sub: 'Housekeeping & maintenance' },
  { icon: Zap, label: 'Reliable', sub: 'Power, water & WiFi' },
  { icon: ShieldCheck, label: 'Secure', sub: '24/7 security & parking' },
];
const AMENITIES = [
  { icon: Waves, label: 'Swimming Pool' },
  { icon: Trees, label: 'Landscaped Gardens' },
  { icon: Sparkles, label: 'Housekeeping Service' },
  { icon: Wind, label: 'Air Conditioned' },
  { icon: Zap, label: 'Backup Power & Water' },
];
const NEARBY = [
  { mins: '5', label: 'CBD' },
  { mins: '7', label: 'Airport Route' },
  { mins: '5', label: 'Malls & Shops' },
  { mins: '3', label: 'Restaurants' },
  { mins: '2', label: 'Medical Centres' },
];

export function StayPage() {
  const [units, setUnits] = useState<StayUnitOption[]>([]);
  const [checkIn, setCheckIn] = useState(todayISO(2));
  const [checkOut, setCheckOut] = useState(todayISO(5));
  const [guests, setGuests] = useState(2);
  const [unitType, setUnitType] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);

  useEffect(() => {
    getStayInfo()
      .then((d) => {
        setUnits(d.units);
        if (d.units[0]) setUnitType((t) => t || d.units[0].unit_type);
      })
      .catch(() => {});
  }, []);

  const valid = useMemo(
    () =>
      !!(
        checkIn &&
        checkOut &&
        checkOut > checkIn &&
        unitType &&
        name.trim() &&
        isValidEmail(email) &&
        phone.trim() &&
        guests >= 1
      ),
    [checkIn, checkOut, unitType, name, email, phone, guests],
  );

  async function submit() {
    if (!valid || guests < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createBooking({ unit_type: unitType, check_in: checkIn, check_out: checkOut, guests, name: name.trim(), email: email.trim(), phone: phone.trim() });
      setConfirmation(result);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  function pick(t: string) {
    setUnitType(t);
    document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' });
  }

  if (confirmation) {
    return (
      <div className="min-h-screen bg-paper text-ink">
        <Nav />
        <ConfirmationView confirmation={confirmation} onReset={() => { setConfirmation(null); setName(''); setEmail(''); setPhone(''); }} />
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <Nav />

      <section className="relative" style={{ minHeight: 600 }}>
        <img src="/lifestyle-building.jpg" alt="Lifestyle Apartments, Gaborone" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(100deg, rgba(12,22,16,0.82) 28%, rgba(12,22,16,0.25) 62%, rgba(12,22,16,0.55))' }} />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-32 md:px-10">
          <div className="text-[11px] tracking-[0.3em] text-[#e0b793]">— GABORONE, BOTSWANA —</div>
          <h1 className="mt-4 font-display text-6xl leading-[0.95] text-[#f8f4ec] md:text-8xl">
            Where Gaborone<br /><span className="italic text-[#d8c2a8]">stays.</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-[#e6e1d5]">
            Boutique serviced apartments for short or long term stays. Space, privacy and comfort — just like home, elevated.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <a href="#apartments" className="rounded-[2px] bg-cream px-6 py-3 text-sm tracking-wide text-forest transition-transform hover:scale-[1.02]">Explore Apartments</a>
            <a href="#book" className="rounded-[2px] border border-cream/60 px-6 py-3 text-sm tracking-wide text-cream transition-colors hover:bg-cream/10">Check Availability</a>
          </div>
          <div className="mt-6 flex items-center gap-2 text-cream/90">
            <span className="flex">{[0,1,2,3,4].map((i) => <Star key={i} className="h-4 w-4 fill-[#e0b793] text-[#e0b793]" />)}</span>
            <span className="text-xs tracking-wide">Trusted by business travellers &amp; families</span>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-6 md:px-10">
            <div className="grid grid-cols-2 divide-x divide-cream/15 rounded-t-lg border border-cream/15 bg-[rgba(20,32,24,0.6)] backdrop-blur md:grid-cols-4">
              {HERO_FEATURES.map((f) => (
                <div key={f.sub} className="flex items-center gap-3 px-5 py-4">
                  <f.icon className="h-5 w-5 text-[#e0b793]" />
                  <div className="leading-tight">
                    <div className="text-sm text-cream">{f.label}</div>
                    <div className="text-[11px] text-cream/70">{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16 md:px-10">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-center">
          <div>
            <div className="text-[11px] tracking-[0.22em] text-muted">WHY GUESTS CHOOSE US —</div>
            <h2 className="mt-3 font-display text-4xl text-ink">Luxury living.<br /><span className="italic text-terra">Uncomplicated.</span></h2>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">We blend hotel-style service with the freedom of a private home.</p>
            <p className="mt-3 font-display text-sm italic text-ink">Boutique. Secure. Serene.</p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-5 sm:gap-x-2">
            {WHY.map((f) => (
              <div key={f.label} className="text-center">
                <f.icon className="mx-auto h-6 w-6 text-forest" />
                <div className="mt-2 text-sm text-ink">{f.label}</div>
                <div className="mt-1 text-[11px] leading-snug text-muted">{f.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="apartments" className="bg-cream-2/40 py-16">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <div className="text-center text-[11px] tracking-[0.22em] text-muted">OUR APARTMENTS</div>
          <h2 className="mt-2 text-center font-display text-4xl text-ink">Spaces designed for how you <span className="italic">live</span>.</h2>
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {units.map((u, i) => (
              <div key={u.unit_type} className="group overflow-hidden rounded-lg border border-line bg-white">
                <div className="h-52 overflow-hidden">
                  <img src={UNIT_PHOTOS[i % UNIT_PHOTOS.length]} alt={u.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                </div>
                <div className="flex items-center justify-between gap-3 p-5">
                  <div className="min-w-0">
                    <div className="font-display text-xl text-ink">{unitLabel(u.unit_type)}</div>
                    <div className="mt-1 text-xs text-muted">{UNIT_BLURB[u.unit_type] ?? `Sleeps ${u.max_guests}`}</div>
                    <div className="mt-2 text-sm text-ink">from <span className="font-medium">{formatMoney(u.nightly_rate, u.currency)}</span><span className="text-muted"> / night</span></div>
                  </div>
                  <button onClick={() => pick(u.unit_type)} aria-label={`Book ${u.unit_type}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest text-cream transition-transform hover:scale-110">
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="experience" className="mx-auto max-w-6xl px-6 py-16 md:px-10">
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_1.4fr_1fr]">
          <div className="overflow-hidden rounded-lg"><img src="/stay/pool.jpg" alt="Swimming pool" className="h-full min-h-[220px] w-full object-cover" /></div>
          <div className="flex flex-col items-center justify-center rounded-lg bg-cream-2/50 px-6 py-10 text-center">
            <div className="text-[11px] tracking-[0.22em] text-muted">THE LIFESTYLE EXPERIENCE</div>
            <h2 className="mt-2 font-display text-3xl text-ink">More than a place to stay.<br />It’s a place to <span className="italic">breathe</span>.</h2>
            <div className="mt-7 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-5">
              {AMENITIES.map((a) => (
                <div key={a.label} className="w-16 text-center">
                  <a.icon className="mx-auto h-5 w-5 text-forest" />
                  <div className="mt-1.5 text-[10px] leading-snug text-muted">{a.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg"><img src="/stay/lounge.jpg" alt="Lounge" className="h-full min-h-[220px] w-full object-cover" /></div>
        </div>
      </section>

      <section id="location" className="mx-auto max-w-6xl px-6 pb-16 md:px-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[0.8fr_1.2fr] md:items-center">
          <div>
            <div className="text-[11px] tracking-[0.22em] text-muted">PERFECTLY LOCATED</div>
            <h2 className="mt-2 font-display text-4xl text-ink">Close to <span className="italic">everything</span><br />that matters.</h2>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">Minutes from Gaborone’s business district, restaurants, shopping, medical centres and the airport route.</p>
            <a href="https://maps.google.com/?q=Lifestyle+Apartments+Gaborone" target="_blank" rel="noreferrer" className="mt-6 inline-block rounded-[2px] bg-forest px-5 py-2.5 text-sm text-cream">Get Directions</a>
          </div>
          <div className="relative overflow-hidden rounded-lg border border-line" style={{ minHeight: 240 }}>
            <img src="/stay/outdoor.jpg" alt="Neighbourhood" className="absolute inset-0 h-full w-full object-cover opacity-40" />
            <div className="absolute inset-0 bg-paper/40" />
            <div className="relative grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
              {NEARBY.map((n) => (
                <div key={n.label} className="rounded-md bg-white/90 px-3 py-3 text-center">
                  <div className="font-display text-xl text-forest">{n.mins}<span className="text-xs"> min</span></div>
                  <div className="mt-1 text-[10px] leading-snug text-muted">{n.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="book" className="bg-cream-2/40 py-16">
        <div className="mx-auto max-w-2xl px-6 md:px-10">
          <div className="text-center text-[11px] tracking-[0.22em] text-muted">RESERVE</div>
          <h2 className="mt-2 text-center font-display text-4xl text-ink">Reserve your stay.</h2>
          <p className="mt-2 text-center text-sm text-muted">Tell us your dates — we’ll hold a unit and confirm by email. Pay your deposit on arrival.</p>

          <div className="mt-8 flex flex-col gap-4 rounded-lg border border-line bg-white p-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1"><Label htmlFor="ci">Check-in</Label><Input id="ci" type="date" min={todayISO(0)} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></div>
              <div className="flex flex-col gap-1"><Label htmlFor="co">Check-out</Label><Input id="co" type="date" min={checkIn || todayISO(1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="ut">Apartment</Label>
                <Select id="ut" value={unitType} onChange={(e) => setUnitType(e.target.value)}>
                  {units.map((u) => <option key={u.unit_type} value={u.unit_type}>{unitLabel(u.unit_type)} — from {formatMoney(u.nightly_rate, u.currency)}/night</option>)}
                </Select>
              </div>
              <div className="flex flex-col gap-1"><Label htmlFor="g">Guests</Label><Input id="g" type="number" min={1} max={20} value={guests} onChange={(e) => setGuests(Number(e.target.value))} /></div>
            </div>
            <div className="flex flex-col gap-1"><Label htmlFor="nm">Full name</Label><Input id="nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Naledi Moeng" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1"><Label htmlFor="em">Email</Label><Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></div>
              <div className="flex flex-col gap-1"><Label htmlFor="ph">Phone</Label><Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+267 …" /></div>
            </div>
            {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <Button variant="primary" className="mt-1 h-11" disabled={!valid || submitting} onClick={submit}>{submitting && <Spinner className="text-cream" />} Request to book</Button>
            <p className="text-center text-xs text-muted">No payment now — your booking is held and confirmed by our team.</p>
          </div>
        </div>
      </section>

      <section className="bg-forest px-6 py-14 text-cream md:px-10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <h2 className="font-display text-4xl">Ready to make yourself <span className="italic text-[#d8c2a8]">at home?</span></h2>
          <div className="flex gap-3">
            <a href="#book" className="rounded-[2px] bg-cream px-6 py-3 text-sm text-forest">Book Your Stay</a>
            <a href="https://wa.me/26775528644" target="_blank" rel="noreferrer" className="rounded-[2px] border border-cream/50 px-6 py-3 text-sm text-cream">Call / WhatsApp</a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/90 px-6 py-3.5 backdrop-blur md:px-10">
      <a href="#" className="flex items-center gap-2.5">
        <LifestyleMark className="h-6 w-6 text-forest" />
        <div className="leading-none">
          <div className="text-[11px] tracking-[0.28em] text-ink">LIFESTYLE</div>
          <div className="text-[11px] tracking-[0.28em] text-muted">APARTMENTS</div>
        </div>
      </a>
      <nav className="hidden items-center gap-7 text-xs tracking-wide text-char md:flex">
        <a href="#apartments" className="hover:text-ink">Apartments</a>
        <a href="#experience" className="hover:text-ink">Experience</a>
        <a href="#location" className="hover:text-ink">Location</a>
        <a href="#footer" className="hover:text-ink">Contact</a>
      </nav>
      <a href="#book" className="rounded-[2px] bg-forest px-4 py-2 text-xs tracking-wide text-cream transition-transform hover:scale-[1.03]">Book Your Stay</a>
    </header>
  );
}

function Footer() {
  return (
    <footer id="footer" className="border-t border-line bg-paper px-6 py-10 md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <LifestyleMark className="h-7 w-7 text-forest" />
          <div className="leading-none">
            <div className="text-[11px] tracking-[0.28em] text-ink">LIFESTYLE APARTMENTS</div>
            <div className="mt-1 font-display text-xs italic text-muted">Boutique Luxury Serviced Apartments</div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 text-xs text-muted">
          <span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> +267 755 28644 · +267 754 36985</span>
          <span className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> info@lifestyleapartments.co.bw</span>
          <span className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> Gaborone, Botswana</span>
        </div>
        <div className="flex gap-3 text-muted">
          <a href="https://www.facebook.com/lifestyleapartmentsbw/" target="_blank" rel="noreferrer" className="hover:text-forest"><Facebook className="h-5 w-5" /></a>
          <a href="https://www.facebook.com/lifestyleapartmentsbw/" target="_blank" rel="noreferrer" className="hover:text-forest"><Instagram className="h-5 w-5" /></a>
        </div>
      </div>
    </footer>
  );
}

function ConfirmationView({ confirmation: c, onReset }: { confirmation: BookingConfirmation; onReset: () => void }) {
  const p = c.pricing;
  return (
    <section className="mx-auto max-w-xl px-6 py-16 md:px-10">
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="bg-forest px-7 py-8 text-center text-cream">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-cream"><span className="font-display text-2xl text-forest">✓</span></div>
          <div className="font-display text-2xl">You’re booked, {c.guest_name.split(' ')[0]}.</div>
          <div className="mt-1 text-[11px] tracking-[0.2em] text-cream/70">CONFIRMATION {c.confirmation_code}</div>
        </div>
        <div className="p-6">
          <div className="font-display text-lg text-ink">{c.unit_name}</div>
          <div className="mt-3 border-t border-line pt-3 text-sm">
            <Row label="Check-in" value={fmtDate(c.check_in)} />
            <Row label="Check-out" value={fmtDate(c.check_out)} />
            <Row label="Guests" value={String(c.guests)} />
          </div>
          {p.priceable && (
            <div className="mt-3 border-t border-line pt-3 text-sm">
              <Row label="Stay total" value={formatMoney(p.total_amount, p.currency)} />
              <div className="flex items-center justify-between py-1"><span className="font-medium text-ink">Deposit on arrival</span><span className="font-medium text-terra">{formatMoney(p.deposit_amount, p.currency)}</span></div>
            </div>
          )}
          <div className="mt-4 rounded-md bg-cream-2 px-3 py-2.5 text-xs leading-relaxed text-muted">We’ve emailed your confirmation. Our team will be in touch to finalise your arrival. No payment was taken online.</div>
          <Button variant="outline" className="mt-4 w-full" onClick={onReset}>Book another stay</Button>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between py-1 text-muted"><span>{label}</span><span className="text-ink">{value}</span></div>;
}
