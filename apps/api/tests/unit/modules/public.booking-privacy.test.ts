import { describe, it, expect, vi } from 'vitest';
import { PublicService } from '../../../src/modules/public/public.service.js';

// (R6 NEW-5, privacy) The /stay page is public. Typing an existing guest's email used to
// attach the booking to that guest and echo THEIR stored name back ("You're booked, Thato"
// for someone who typed "R6 Public Tester") — anyone could learn who owns an email. The
// typed name and phone were thrown away too.
//
// Now: the existing contact is reused only when email AND phone both match (the same person
// coming back). Otherwise a NEW contact is created with what was typed, flagged as a
// possible duplicate for staff to check. Either way the reply carries the TYPED name only.

const existing = { id: 'c-thato', name: 'Thato Existing', email: 'thato@example.com', phone: '+267 71 234 567' };

function serviceFor(found: typeof existing | undefined) {
  const repository = {
    activePlans: vi.fn().mockResolvedValue([{ unit_type: 'SUITE', nightly_rate: 150_000 }]),
    systemActorId: vi.fn().mockResolvedValue('actor'),
    findContactByEmail: vi.fn().mockResolvedValue(found),
    bookableRoomsByType: vi.fn().mockResolvedValue([{ id: 'r1', code: 'S1', name: 'Suite 1' }]),
  };
  const contacts = { create: vi.fn(async (c: Record<string, unknown>) => ({ id: 'c-new', ...c })) };
  const reservations = {
    checkAvailability: vi.fn().mockResolvedValue(true),
    createReservation: vi.fn(async (r: Record<string, unknown>) => ({
      id: '11111111-2222-3333-4444-555555555555', check_in_date: new Date('2027-01-10'), check_out_date: new Date('2027-01-12'), ...r,
    })),
    ensureReceivable: vi.fn().mockResolvedValue(undefined),
    priceReservation: vi.fn().mockResolvedValue({ total: 300_000 }),
  };
  const service = new PublicService(repository as never, reservations as never, contacts as never, {} as never);
  return { service, contacts, reservations };
}

const booking = (over: Record<string, unknown>) => ({
  unit_type: 'SUITE', check_in: '2027-01-10', check_out: '2027-01-12', guests: 1,
  name: 'R6 Public Tester', email: 'THATO@example.com', phone: '+267 72 000 000', ...over,
}) as never;

describe('PublicService.createBooking — never reveals who owns an email', () => {
  it('a different person with an existing email: new flagged contact, reply carries the typed name', async () => {
    const { service, contacts, reservations } = serviceFor(existing);
    const res = await service.createBooking(booking({}), { ip: '1.1.1.1' });

    expect(res.guest_name).toBe('R6 Public Tester');
    expect(JSON.stringify(res)).not.toContain('Thato Existing');
    expect(contacts.create).toHaveBeenCalledTimes(1);
    const created = contacts.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(created).toMatchObject({ name: 'R6 Public Tester', phone: '+267 72 000 000' });
    expect(String(created.notes)).toMatch(/possible duplicate/i);
    expect(reservations.createReservation.mock.calls[0]![0]).toMatchObject({ contact_id: 'c-new' });
  });

  it('the same person returning (email AND phone match, any spacing): reuses the contact, still echoes the typed name', async () => {
    const { service, contacts, reservations } = serviceFor(existing);
    const res = await service.createBooking(booking({ name: 'Thato M', phone: '+26771234567' }), { ip: '1.1.1.1' });

    expect(contacts.create).not.toHaveBeenCalled();
    expect(reservations.createReservation.mock.calls[0]![0]).toMatchObject({ contact_id: 'c-thato' });
    expect(res.guest_name).toBe('Thato M');
  });

  it('a brand-new email: an ordinary new contact, no duplicate flag', async () => {
    const { service, contacts } = serviceFor(undefined);
    const res = await service.createBooking(booking({ email: 'new@example.com' }), { ip: '1.1.1.1' });
    expect(res.guest_name).toBe('R6 Public Tester');
    expect(String((contacts.create.mock.calls[0]![0] as Record<string, unknown>).notes)).not.toMatch(/duplicate/i);
  });
});
