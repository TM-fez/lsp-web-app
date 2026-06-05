import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AvailabilityService } from '../../../../src/modules/availability/availability.service.js';
import { AvailabilityRepository } from '../../../../src/modules/availability/availability.repository.js';

describe('AvailabilityService', () => {
  let service: AvailabilityService;
  let repository: vi.Mocked<AvailabilityRepository>;

  beforeEach(() => {
    repository = {
      findRoomSignals: vi.fn(),
      getSummaryCounts: vi.fn(),
      getCalendar: vi.fn(),
    } as unknown as vi.Mocked<AvailabilityRepository>;

    service = new AvailabilityService(repository);
  });

  describe('getRoomAvailability', () => {
    it('should determine correct verdicts for maintenance and active occupancy', async () => {
      repository.findRoomSignals.mockResolvedValue([
        { id: '1', name: 'R1', code: '101', type: 'STANDARD', status: 'MAINTENANCE', capacity: 2, overlapping_reservations: 0, active_occupancy: 0, total_count: 2 },
        { id: '2', name: 'R2', code: '102', type: 'STANDARD', status: 'AVAILABLE', capacity: 2, overlapping_reservations: 0, active_occupancy: 1, total_count: 2 },
      ]);

      const res = await service.getRoomAvailability({ check_in: new Date(), check_out: new Date(), page: 1, limit: 10 });
      expect(res.rooms[0].available).toBe(false);
      expect(res.rooms[0].reason).toBe('MAINTENANCE');
      expect(res.rooms[1].available).toBe(false);
      expect(res.rooms[1].reason).toBe('OCCUPIED');
    });

    it('should return available for clear rooms', async () => {
      repository.findRoomSignals.mockResolvedValue([
        { id: '3', name: 'R3', code: '103', type: 'STANDARD', status: 'AVAILABLE', capacity: 2, overlapping_reservations: 0, active_occupancy: 0, total_count: 1 },
      ]);

      const res = await service.getRoomAvailability({ check_in: new Date(), check_out: new Date(), page: 1, limit: 10 });
      expect(res.rooms[0].available).toBe(true);
      expect(res.rooms[0].reason).toBe(null);
    });
  });

  describe('getQuote', () => {
    it('should aggregate counts correctly', async () => {
      repository.getSummaryCounts.mockResolvedValue({
        total: 10,
        available: 8,
        maintenance: 1,
        out_of_service: 0,
        occupied: 1,
        reserved: 0
      });

      const res = await service.getQuote({ check_in: new Date(), check_out: new Date() });
      expect(res.status).toBe('AVAILABLE');
      expect(res.total_rooms).toBe(10);
      expect(res.available_rooms).toBe(8);
      expect(res.occupancy_rate).toBe(0.1);
    });
  });
});
