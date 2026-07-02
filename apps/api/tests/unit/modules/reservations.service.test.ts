import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReservationsService, isReservationOverlapError } from '../../../src/modules/reservations/reservations.service';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository';

describe('ReservationsService', () => {
  let service: ReservationsService;
  let repository: vi.Mocked<ReservationsRepository>;

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      findPaginated: vi.fn(),
      checkAvailability: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      contactExists: vi.fn(),
    } as unknown as vi.Mocked<ReservationsRepository>;

    service = new ReservationsService(repository);
  });

  describe('createReservation', () => {
    it('should throw if check-in date is in the past', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const dto = { 
        contact_id: 'c1', room_id: 'r1', 
        check_in_date: pastDate, 
        check_out_date: new Date() 
      };
      
      await expect(service.createReservation(dto as any, {} as any))
        .rejects.toThrow('Cannot create reservation with check-in date in the past');
    });

    it('should throw if room is not available', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      
      repository.checkAvailability.mockResolvedValue(false);

      const dto = { 
        contact_id: 'c1', room_id: 'r1', 
        check_in_date: tomorrow, 
        check_out_date: nextWeek 
      };

      await expect(service.createReservation(dto as any, {} as any))
        .rejects.toThrow('Room is not available for the selected dates');
    });

    it('should create if validations pass', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      
      repository.checkAvailability.mockResolvedValue(true);
      repository.create.mockResolvedValue({ id: 'res1' } as any);

      const dto = { 
        contact_id: 'c1', room_id: 'r1', 
        check_in_date: tomorrow, 
        check_out_date: nextWeek 
      };

      const meta = { userId: 'u1', ip: '127.0.0.1', requestId: 'req1' };
      const res = await service.createReservation(dto as any, meta);
      
      expect(res.id).toBe('res1');
      expect(repository.create).toHaveBeenCalled();
    });

    it('forces new reservations to PENDING even when a client supplies CONFIRMED', async () => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      repository.checkAvailability.mockResolvedValue(true);
      repository.create.mockResolvedValue({ id: 'res1', status: 'PENDING' } as any);

      const dto = { contact_id: 'c1', room_id: 'r1', check_in_date: tomorrow, check_out_date: nextWeek, status: 'CONFIRMED' };
      await service.createReservation(dto as any, { userId: 'u1' } as any);

      const passed = (repository.create as any).mock.calls[0][0];
      expect(passed.status).toBe('PENDING'); // only settlePaid() may confirm
    });

    it('rejects a bogus CRM contact with a clean 400 (coordinator + billing checked)', async () => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      repository.contactExists.mockResolvedValue(false);

      const base = { contact_id: 'c1', room_id: 'r1', check_in_date: tomorrow, check_out_date: nextWeek };
      await expect(
        service.createReservation({ ...base, booking_coordinator_id: 'ghost' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow('Booking coordinator must be an existing contact');
      await expect(
        service.createReservation({ ...base, billing_contact_id: 'ghost' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow('Billing contact must be an existing contact');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('accepts valid CRM contacts and passes them through to the insert', async () => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      repository.contactExists.mockResolvedValue(true);
      repository.checkAvailability.mockResolvedValue(true);
      repository.create.mockResolvedValue({ id: 'res1' } as any);

      const dto = {
        contact_id: 'c1', room_id: 'r1', check_in_date: tomorrow, check_out_date: nextWeek,
        booking_coordinator_id: 'coord1', billing_contact_id: 'bill1',
      };
      await service.createReservation(dto as any, { userId: 'u1' } as any);

      const passed = (repository.create as any).mock.calls[0][0];
      expect(passed.booking_coordinator_id).toBe('coord1');
      expect(passed.billing_contact_id).toBe('bill1');
    });

    it('translates the DB overlap constraint (a race) into a 409 conflict', async () => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      repository.checkAvailability.mockResolvedValue(true); // passes the pre-check…
      // …but another booking raced in; the DB exclusion constraint rejects the insert.
      repository.create.mockRejectedValue({ code: '23P01', constraint: 'reservations_no_overlap' });
      const dto = { contact_id: 'c1', room_id: 'r1', check_in_date: tomorrow, check_out_date: nextWeek };
      await expect(service.createReservation(dto as any, { userId: 'u1' } as any))
        .rejects.toThrow('Room is not available for the selected dates');
    });
  });

  describe('modifyReservation — commercial invariant', () => {
    it('rejects a direct edit to CONFIRMED (only settlePaid may confirm)', async () => {
      repository.findById.mockResolvedValue({ id: 'res1', status: 'PENDING' } as any);
      await expect(
        service.modifyReservation('res1', { status: 'CONFIRMED' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow(/set by the system/i);
    });

    it('rejects a direct edit to CHECKED_IN', async () => {
      repository.findById.mockResolvedValue({ id: 'res1', status: 'CONFIRMED' } as any);
      await expect(
        service.modifyReservation('res1', { status: 'CHECKED_IN' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow(/set by the system/i);
    });
  });

  describe('claimOtaBooking — Tier 1 OTA contact capture', () => {
    const block = { id: 'res-b', status: 'BLOCKED', source: 'BOOKING_COM' };

    it('attaches the contact and promotes the block to CONFIRMED', async () => {
      repository.findById.mockResolvedValue(block as any);
      repository.contactExists.mockResolvedValue(true);
      repository.update.mockResolvedValue({ ...block, status: 'CONFIRMED', contact_id: 'c9' } as any);

      const res = await service.claimOtaBooking('res-b', { contact_id: 'c9' }, { userId: 'u1' } as any);

      expect(res.status).toBe('CONFIRMED');
      expect(repository.update).toHaveBeenCalledWith(
        'res-b',
        expect.objectContaining({ contact_id: 'c9', status: 'CONFIRMED' }),
        expect.anything(),
      );
    });

    it('refuses anything that is not an unclaimed Booking.com block', async () => {
      repository.findById.mockResolvedValue({ ...block, status: 'CONFIRMED' } as any);
      await expect(
        service.claimOtaBooking('res-b', { contact_id: 'c9' }, { userId: 'u1' } as any),
      ).rejects.toThrow('Only an unclaimed Booking.com block can be claimed');

      repository.findById.mockResolvedValue({ ...block, source: 'DIRECT' } as any);
      await expect(
        service.claimOtaBooking('res-b', { contact_id: 'c9' }, { userId: 'u1' } as any),
      ).rejects.toThrow('Only an unclaimed Booking.com block can be claimed');
    });

    it('refuses a contact that does not exist', async () => {
      repository.findById.mockResolvedValue(block as any);
      repository.contactExists.mockResolvedValue(false);
      await expect(
        service.claimOtaBooking('res-b', { contact_id: 'ghost' }, { userId: 'u1' } as any),
      ).rejects.toThrow('Contact not found');
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('isReservationOverlapError', () => {
    it('matches the no-overlap exclusion violation', () => {
      expect(isReservationOverlapError({ code: '23P01', constraint: 'reservations_no_overlap' })).toBe(true);
    });
    it('ignores other errors', () => {
      expect(isReservationOverlapError({ code: '23505', constraint: 'reservations_no_overlap' })).toBe(false);
      expect(isReservationOverlapError({ code: '23P01', constraint: 'other' })).toBe(false);
      expect(isReservationOverlapError(new Error('nope'))).toBe(false);
      expect(isReservationOverlapError(null)).toBe(false);
    });
  });
});
