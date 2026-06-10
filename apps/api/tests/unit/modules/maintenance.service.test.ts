import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaintenanceService } from '../../../src/modules/maintenance/maintenance.service.js';
import { MaintenanceRepository } from '../../../src/modules/maintenance/maintenance.repository.js';
import { FilesRepository } from '../../../src/modules/files/files.repository.js';
import { AppError } from '../../../src/core/errors/AppError.js';

describe('MaintenanceService', () => {
  let service: MaintenanceService;
  let repo: vi.Mocked<MaintenanceRepository>;
  let filesRepo: vi.Mocked<FilesRepository>;

  beforeEach(() => {
    repo = {
      create: vi.fn(),
      findById: vi.fn(),
      findPaginated: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      updateRoomStatus: vi.fn(),
      transaction: vi.fn(async (cb) => cb({} as any)),
    } as unknown as vi.Mocked<MaintenanceRepository>;

    filesRepo = {
      findById: vi.fn(),
    } as unknown as vi.Mocked<FilesRepository>;

    service = new MaintenanceService(repo, filesRepo);
  });

  it('openWorkOrder sets room status to MAINTENANCE', async () => {
    repo.create.mockResolvedValue({ id: 'm1' } as any);
    await service.openWorkOrder({ room_id: 'r1', title: 'Fix sink', priority: 'HIGH' }, { userId: 'u1' });
    expect(repo.create).toHaveBeenCalled();
    expect(repo.updateRoomStatus).toHaveBeenCalledWith('r1', 'MAINTENANCE', { userId: 'u1' }, expect.anything());
  });

  it('complete work restores room status to AVAILABLE', async () => {
    repo.findById.mockResolvedValue({ id: 'm1', room_id: 'r1', status: 'IN_PROGRESS' } as any);
    repo.update.mockResolvedValue({ id: 'm1' } as any);
    await service.complete('m1', {}, { userId: 'u1' });
    expect(repo.update).toHaveBeenCalledWith('m1', expect.objectContaining({ status: 'COMPLETED' }), { userId: 'u1' }, expect.anything());
    expect(repo.updateRoomStatus).toHaveBeenCalledWith('r1', 'AVAILABLE', { userId: 'u1' }, expect.anything());
  });

  it('rejects an illegal transition with a 409 AppError, not a generic 500', async () => {
    repo.findById.mockResolvedValue({ id: 'm1', status: 'COMPLETED' } as any);
    const err = await service.start('m1', {}, { userId: 'u1' }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('Cannot start work order from status COMPLETED');
  });

  it('surfaces a missing work order as a 404 AppError', async () => {
    repo.findById.mockResolvedValue(undefined);
    const err = await service.get('nope').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
  });

  it('validates files integration on start', async () => {
    repo.findById.mockResolvedValue({ id: 'm1', status: 'OPEN' } as any);
    filesRepo.findById.mockResolvedValue(null);
    await expect(service.start('m1', { before_file_id: 'bad-id' }, { userId: 'u1' })).rejects.toThrow('Invalid before_file_id');
  });
});
