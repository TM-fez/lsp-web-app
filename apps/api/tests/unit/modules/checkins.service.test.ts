import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckinsService } from '../../../src/modules/checkins/checkins.service';
import { CheckinsRepository } from '../../../src/modules/checkins/checkins.repository';

describe('CheckinsService', () => {
  let service: CheckinsService;
  let repository: vi.Mocked<CheckinsRepository>;
  const meta = { userId: 'u1', ip: '127.0.0.1', requestId: 'req-1' };

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      findReservation: vi.fn(),
      findRoom: vi.fn(),
      findActive: vi.fn(),
      findPaginated: vi.fn(),
      checkIn: vi.fn(),
      checkOut: vi.fn(),
    } as unknown as vi.Mocked<CheckinsRepository>;

    service = new CheckinsService(repository);
  });

  describe('checkIn', () => {
    const dto = { reservation_id: 'res1', guest_count: 2 } as any;

    it('throws 404 when the reservation does not exist', async () => {
      repository.findReservation.mockResolvedValue(undefined);
      await expect(service.checkIn(dto, meta)).rejects.toThrow('not found');
      expect(repository.checkIn).not.toHaveBeenCalled();
    });

    it('throws 409 when the reservation is not CONFIRMED', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'PENDING', room_id: 'rm1' } as any);
      await expect(service.checkIn(dto, meta)).rejects.toThrow('must be CONFIRMED');
      expect(repository.checkIn).not.toHaveBeenCalled();
    });

    it('throws 409 when the room is not AVAILABLE', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'CONFIRMED', room_id: 'rm1' } as any);
      repository.findRoom.mockResolvedValue({ id: 'rm1', status: 'OCCUPIED' } as any);
      await expect(service.checkIn(dto, meta)).rejects.toThrow('not available');
      expect(repository.checkIn).not.toHaveBeenCalled();
    });

    it('checks in when reservation is CONFIRMED and room AVAILABLE', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'CONFIRMED', room_id: 'rm1' } as any);
      repository.findRoom.mockResolvedValue({ id: 'rm1', status: 'AVAILABLE' } as any);
      repository.checkIn.mockResolvedValue({ id: 'occ1', status: 'CHECKED_IN' } as any);

      const result = await service.checkIn(dto, meta);

      expect(result.id).toBe('occ1');
      expect(repository.checkIn).toHaveBeenCalledWith(
        expect.objectContaining({ reservationId: 'res1', roomId: 'rm1', guestCount: 2 }),
        meta
      );
    });
  });

  describe('checkOut', () => {
    it('throws 404 when the occupancy does not exist', async () => {
      repository.findById.mockResolvedValue(undefined);
      await expect(service.checkOut('occ1', {} as any, meta)).rejects.toThrow('not found');
    });

    it('throws 409 when already checked out', async () => {
      repository.findById.mockResolvedValue({ id: 'occ1', status: 'CHECKED_OUT', checked_in_at: new Date() } as any);
      await expect(service.checkOut('occ1', {} as any, meta)).rejects.toThrow('already been checked out');
    });

    it('throws 400 when checkout time precedes check-in', async () => {
      const checkedIn = new Date('2026-07-02T10:00:00Z');
      repository.findById.mockResolvedValue({ id: 'occ1', status: 'CHECKED_IN', checked_in_at: checkedIn, reservation_id: 'res1', room_id: 'rm1' } as any);
      await expect(
        service.checkOut('occ1', { checked_out_at: new Date('2026-07-01T10:00:00Z') } as any, meta)
      ).rejects.toThrow('before check-in');
    });

    it('checks out an active occupancy', async () => {
      repository.findById.mockResolvedValue({ id: 'occ1', status: 'CHECKED_IN', checked_in_at: new Date('2020-01-01'), reservation_id: 'res1', room_id: 'rm1' } as any);
      repository.checkOut.mockResolvedValue({ id: 'occ1', status: 'CHECKED_OUT' } as any);

      const result = await service.checkOut('occ1', {} as any, meta);

      expect(result.status).toBe('CHECKED_OUT');
      expect(repository.checkOut).toHaveBeenCalledWith('occ1', 'res1', 'rm1', expect.any(Date), undefined, meta);
    });
  });
});
