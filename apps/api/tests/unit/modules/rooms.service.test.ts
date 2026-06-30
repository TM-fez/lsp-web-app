import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomsService } from '../../../src/modules/rooms/rooms.service';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository';

describe('RoomsService', () => {
  let service: RoomsService;
  let repository: vi.Mocked<RoomsRepository>;
  const meta = { userId: 'u1', ip: '127.0.0.1', requestId: 'req-1' };

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      findByCodeInBuilding: vi.fn(),
      findPaginated: vi.fn(),
      listAvailable: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
    } as unknown as vi.Mocked<RoomsRepository>;

    service = new RoomsService(repository);
  });

  describe('getRoomById', () => {
    it('returns the room when found', async () => {
      repository.findById.mockResolvedValue({ id: '1', code: 'A1' } as any);
      const result = await service.getRoomById('1');
      expect(result).toEqual({ id: '1', code: 'A1' });
    });

    it('throws 404 when not found', async () => {
      repository.findById.mockResolvedValue(undefined);
      await expect(service.getRoomById('1')).rejects.toThrow('Room with id 1 not found');
    });
  });

  describe('createRoom', () => {
    it('throws 409 when the code is already in use', async () => {
      repository.findByCodeInBuilding.mockResolvedValue({ id: 'x', code: 'A1' } as any);
      await expect(
        service.createRoom({ name: 'Room A1', code: 'A1', type: 'STANDARD', status: 'AVAILABLE', capacity: 2 } as any, meta)
      ).rejects.toThrow('already in use');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('creates the room (stamping created_by/updated_by) when the code is free', async () => {
      repository.findByCodeInBuilding.mockResolvedValue(undefined);
      repository.create.mockResolvedValue({ id: 'r1' } as any);

      const dto = { name: 'Room A1', code: 'A1', type: 'STANDARD', status: 'AVAILABLE', capacity: 2 } as any;
      const result = await service.createRoom(dto, meta);

      expect(result).toEqual({ id: 'r1' });
      expect(repository.create).toHaveBeenCalledWith(
        { ...dto, created_by: 'u1', updated_by: 'u1' },
        meta
      );
    });

    it('scopes the code-uniqueness check to the building (per-property naming)', async () => {
      repository.findByCodeInBuilding.mockResolvedValue(undefined);
      repository.create.mockResolvedValue({ id: 'r2' } as any);

      const dto = { name: '101', code: '101', type: 'STANDARD', status: 'AVAILABLE', capacity: 2, building_id: 'bldg-J' } as any;
      await service.createRoom(dto, meta);

      // The same code in a different block must be allowed — so the lookup is per-building.
      expect(repository.findByCodeInBuilding).toHaveBeenCalledWith('101', 'bldg-J');
    });
  });

  describe('setMaintenance', () => {
    it('throws 409 when the room is occupied', async () => {
      repository.findById.mockResolvedValue({ id: 'r1', status: 'OCCUPIED' } as any);
      await expect(service.setMaintenance('r1', meta)).rejects.toThrow('occupied room to maintenance');
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('sets status to MAINTENANCE for a non-occupied room', async () => {
      repository.findById.mockResolvedValue({ id: 'r1', status: 'AVAILABLE' } as any);
      repository.update.mockResolvedValue({ id: 'r1', status: 'MAINTENANCE' } as any);

      const result = await service.setMaintenance('r1', meta);

      expect(result.status).toBe('MAINTENANCE');
      expect(repository.update).toHaveBeenCalledWith('r1', { status: 'MAINTENANCE', updated_by: 'u1' }, meta);
    });
  });

  describe('restoreRoom', () => {
    it('sets status back to AVAILABLE', async () => {
      repository.findById.mockResolvedValue({ id: 'r1', status: 'MAINTENANCE' } as any);
      repository.update.mockResolvedValue({ id: 'r1', status: 'AVAILABLE' } as any);

      const result = await service.restoreRoom('r1', meta);

      expect(result.status).toBe('AVAILABLE');
      expect(repository.update).toHaveBeenCalledWith('r1', { status: 'AVAILABLE', updated_by: 'u1' }, meta);
    });
  });
});
