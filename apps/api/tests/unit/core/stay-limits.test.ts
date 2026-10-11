import { describe, it, expect } from 'vitest';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { CreateBookingSchema } from '../../../src/modules/public/public.types.js';
import { CreateQuoteSchema } from '../../../src/modules/quotes/quotes.types.js';
import { CreateReservationSchema } from '../../../src/modules/reservations/reservations.types.js';
import {
  MAX_PUBLIC_LEAD_DAYS,
  MAX_PUBLIC_STAY_NIGHTS,
  MAX_STAY_NIGHTS,
  stayNights,
} from '../../../src/core/stayLimits.js';

// (Audit 2026-10-11, H-1) One anonymous /stay booking leaving in the far future made the
// price engine allocate arrays the length of the stay and crashed the API. These pin the
// ceilings so the crash can't come back through any door.

const plan = {
  nightly_rate: 10_000,
  weekly_rate: 60_000,
  monthly_rate: 200_000,
} as never;

const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const booking = (check_in: string, check_out: string) => ({
  unit_type: 'SUITE',
  check_in,
  check_out,
  guests: 1,
  name: 'Guest',
  email: 'g@example.com',
  phone: '+267 7100 0000',
});

describe('PricingService.priceStay — stay ceiling', () => {
  const svc = new PricingService({} as never);

  it('prices a stay at the ceiling', () => {
    expect(svc.priceStay(plan, MAX_STAY_NIGHTS).base_amount).toBeGreaterThan(0);
  });

  it('refuses one night more, as a 400, without allocating', () => {
    expect(() => svc.priceStay(plan, MAX_STAY_NIGHTS + 1)).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  it('refuses the stay that crashed the API (~99 million nights) at once', () => {
    const started = Date.now();
    expect(() => svc.priceStay(plan, 99_000_000)).toThrow(/too long/);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('refuses a non-whole number of nights', () => {
    expect(() => svc.priceStay(plan, 2.5)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('CreateBookingSchema — public /stay limits', () => {
  it('accepts an ordinary stay', () => {
    expect(CreateBookingSchema.safeParse(booking(day(10), day(14))).success).toBe(true);
  });

  it('accepts a full year, and refuses a night more', () => {
    const start = 10;
    expect(CreateBookingSchema.safeParse(booking(day(start), day(start + MAX_PUBLIC_STAY_NIGHTS))).success).toBe(true);
    expect(CreateBookingSchema.safeParse(booking(day(start), day(start + MAX_PUBLIC_STAY_NIGHTS + 1))).success).toBe(false);
  });

  it('refuses the far-future check-out that crashed the API', () => {
    const r = CreateBookingSchema.safeParse(booking(day(1), '275000-01-01'));
    expect(r.success).toBe(false);
  });

  it('refuses a check-in more than 18 months ahead', () => {
    const late = MAX_PUBLIC_LEAD_DAYS + 2;
    expect(CreateBookingSchema.safeParse(booking(day(late), day(late + 2))).success).toBe(false);
    expect(CreateBookingSchema.safeParse(booking(day(MAX_PUBLIC_LEAD_DAYS - 1), day(MAX_PUBLIC_LEAD_DAYS + 1))).success).toBe(true);
  });
});

describe('Staff quote and reservation schemas — engine ceiling', () => {
  const longOut = day(1 + MAX_STAY_NIGHTS + 1);

  it('refuses a quote longer than the ceiling', () => {
    const r = CreateQuoteSchema.safeParse({ unit_type: 'SUITE', check_in: day(1), check_out: longOut });
    expect(r.success).toBe(false);
    expect(CreateQuoteSchema.safeParse({ unit_type: 'SUITE', check_in: day(1), check_out: day(30) }).success).toBe(true);
  });

  it('refuses a reservation longer than the ceiling', () => {
    const base = {
      contact_id: '00000000-0000-4000-a000-000000000001',
      room_id: '00000000-0000-4000-a000-000000000003',
    };
    expect(CreateReservationSchema.safeParse({ ...base, check_in_date: day(1), check_out_date: longOut }).success).toBe(false);
    expect(CreateReservationSchema.safeParse({ ...base, check_in_date: day(1), check_out_date: day(60) }).success).toBe(true);
  });
});

describe('stayNights', () => {
  it('counts calendar nights, check-out exclusive', () => {
    expect(stayNights(new Date('2027-01-10'), new Date('2027-01-12'))).toBe(2);
  });
});
