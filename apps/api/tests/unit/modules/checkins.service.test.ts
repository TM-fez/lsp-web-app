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

    // Owner decision 2026-09-07 (invariant 3): money no longer gates the stay. This
    // test used to assert the opposite — that a PENDING booking could NOT check in —
    // and it is inverted deliberately, not relaxed. Refusing an unpaid guest at the
    // desk never collected the money; it just meant the booking was never made, so the
    // room they slept in read as free to everyone else.
    it('checks in a PENDING (unpaid) booking — some guests settle after the stay', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'PENDING', room_id: 'rm1' } as any);
      repository.findRoom.mockResolvedValue({ id: 'rm1', status: 'AVAILABLE', housekeeping_status: 'READY' } as any);
      repository.checkIn.mockResolvedValue({ id: 'occ1', status: 'CHECKED_IN' } as any);

      const result = await service.checkIn(dto, meta);

      expect(result.id).toBe('occ1');
      expect(repository.checkIn).toHaveBeenCalled();
    });

    // A whitelist, so every OTHER status still has to earn its way in.
    it.each([
      ['CANCELLED', 'cancelled booking cannot be checked in'],
      ['CHECKED_OUT', 'checked out booking cannot be checked in'],
      ['NO_SHOW', 'no show booking cannot be checked in'],
    ])('refuses a %s booking', async (status, message) => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status, room_id: 'rm1' } as any);
      await expect(service.checkIn(dto, meta)).rejects.toThrow(message);
      expect(repository.checkIn).not.toHaveBeenCalled();
    });

    it('sends a BLOCKED Booking.com row to the claim flow rather than checking it in', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'BLOCKED', room_id: 'rm1' } as any);
      await expect(service.checkIn(dto, meta)).rejects.toThrow('claim it to a guest');
      expect(repository.checkIn).not.toHaveBeenCalled();
    });

    it('tells you plainly when the guest is already checked in', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'CHECKED_IN', room_id: 'rm1' } as any);
      await expect(service.checkIn(dto, meta)).rejects.toThrow('already checked in');
      expect(repository.checkIn).not.toHaveBeenCalled();
    });

    // The money gate is gone; the OPERATIONAL gates below must be untouched. A unit
    // that is occupied or unclean still cannot take a guest, paid or not.
    it('still refuses an unpaid guest when the room is not READY', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'PENDING', room_id: 'rm1' } as any);
      repository.findRoom.mockResolvedValue({ id: 'rm1', status: 'AVAILABLE', housekeeping_status: 'DIRTY' } as any);
      await expect(service.checkIn(dto, meta)).rejects.toThrow('not ready');
      expect(repository.checkIn).not.toHaveBeenCalled();
    });

    it('throws 409 when the room is not AVAILABLE', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'CONFIRMED', room_id: 'rm1' } as any);
      repository.findRoom.mockResolvedValue({ id: 'rm1', status: 'OCCUPIED' } as any);
      await expect(service.checkIn(dto, meta)).rejects.toThrow('not available');
      expect(repository.checkIn).not.toHaveBeenCalled();
    });

    it('throws 409 when the room is not READY (housekeeping)', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'CONFIRMED', room_id: 'rm1' } as any);
      repository.findRoom.mockResolvedValue({ id: 'rm1', status: 'AVAILABLE', housekeeping_status: 'DIRTY' } as any);
      await expect(service.checkIn(dto, meta)).rejects.toThrow('not ready');
      expect(repository.checkIn).not.toHaveBeenCalled();
    });

    it('checks in when reservation is CONFIRMED and room AVAILABLE + READY', async () => {
      repository.findReservation.mockResolvedValue({ id: 'res1', status: 'CONFIRMED', room_id: 'rm1' } as any);
      repository.findRoom.mockResolvedValue({ id: 'rm1', status: 'AVAILABLE', housekeeping_status: 'READY' } as any);
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
