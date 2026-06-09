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
