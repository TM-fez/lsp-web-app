import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service';
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
  });
});
