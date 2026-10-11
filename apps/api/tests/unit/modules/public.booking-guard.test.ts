import { describe, it, expect, vi } from 'vitest';
import { PublicService } from '../../../src/modules/public/public.service.js';

// A /stay booking for a layout with no active rate plan (or a zero rate) used to be
// created anyway: a P0 stay holding a real unit. It must be refused before anything is
// written — no contact, no reservation.
function serviceWith(plans: { unit_type: string; nightly_rate: number; min_nights?: number; max_guests?: number }[]) {
  const repository = {
    activePlans: vi.fn().mockResolvedValue(plans),
    systemActorId: vi.fn().mockResolvedValue('actor'),
    findContactByEmail: vi.fn(),
    bookableRoomsByType: vi.fn().mockResolvedValue([]),
  };
  const contacts = { create: vi.fn() };
  const reservations = { createReservation: vi.fn(), checkAvailability: vi.fn() };
  const service = new PublicService(repository as never, reservations as never, contacts as never, {} as never);
  return { service, repository, contacts, reservations };
}

const dto = {
  unit_type: 'SUITE', check_in: '2027-01-10', check_out: '2027-01-12', guests: 1,
  name: 'Guest', email: 'g@example.com', phone: '+267 7100 0000',
} as never;

describe('PublicService.createBooking — unpriced layouts', () => {
  it('refuses a layout with no active rate plan, writing nothing', async () => {
    const { service, contacts, reservations } = serviceWith([{ unit_type: 'STUDIO', nightly_rate: 50_000 }]);
    await expect(service.createBooking(dto, { ip: '1.1.1.1' })).rejects.toMatchObject({ statusCode: 400 });
    expect(contacts.create).not.toHaveBeenCalled();
    expect(reservations.createReservation).not.toHaveBeenCalled();
  });

  it('refuses a zero nightly rate', async () => {
    const { service } = serviceWith([{ unit_type: 'SUITE', nightly_rate: 0 }]);
    await expect(service.createBooking(dto, { ip: '1.1.1.1' })).rejects.toThrow(/aren’t open online/);
  });

  it('lets a priced layout through to the availability search', async () => {
    const { service, repository } = serviceWith([{ unit_type: 'SUITE', nightly_rate: 150_000 }]);
    repository.findContactByEmail.mockResolvedValue({ id: 'c1', name: 'Guest' });
    // No free unit → the existing 409, which proves the guard let it past.
    await expect(service.createBooking(dto, { ip: '1.1.1.1' })).rejects.toMatchObject({ statusCode: 409 });
  });
});

// (Audit 2026-10-11, M-2) The rate plan's minimum stay and maximum guests were shown on the
// page but never enforced: a stranger could hold a unit for a stay the house doesn't sell.
describe('PublicService.createBooking — the rate plan’s limits', () => {
  const plan = { unit_type: 'SUITE', nightly_rate: 150_000, min_nights: 3, max_guests: 2 };

  it('refuses a stay shorter than the plan’s minimum, writing nothing', async () => {
    const { service, contacts, reservations } = serviceWith([plan]);
    await expect(service.createBooking(dto, { ip: '1.1.1.1' })).rejects.toThrow(/at least 3 nights/);
    expect(contacts.create).not.toHaveBeenCalled();
    expect(reservations.createReservation).not.toHaveBeenCalled();
  });

  it('refuses more guests than the unit sleeps', async () => {
    const { service } = serviceWith([{ ...plan, min_nights: 1 }]);
    const crowd = { ...(dto as object), guests: 3 } as never;
    await expect(service.createBooking(crowd, { ip: '1.1.1.1' })).rejects.toThrow(/sleeps up to 2/);
  });

  it('lets a stay within the limits through to the availability search', async () => {
    const { service, repository } = serviceWith([{ ...plan, min_nights: 2 }]);
    repository.findContactByEmail.mockResolvedValue({ id: 'c1', name: 'Guest' });
    await expect(service.createBooking(dto, { ip: '1.1.1.1' })).rejects.toMatchObject({ statusCode: 409 });
  });
});
