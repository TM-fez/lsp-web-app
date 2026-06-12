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
      findByIdWithPeople: vi.fn(),
      isActiveUser: vi.fn(),
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

  it('complete restores the room AND stamps completed_by', async () => {
    repo.findById.mockResolvedValue({ id: 'm1', room_id: 'r1', status: 'IN_PROGRESS' } as any);
    repo.update.mockResolvedValue({ id: 'm1' } as any);
    await service.complete('m1', {}, { userId: 'u1' });
    expect(repo.update).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: 'COMPLETED', completed_by: 'u1' }),
      { userId: 'u1' },
      expect.anything(),
    );
    expect(repo.updateRoomStatus).toHaveBeenCalledWith('r1', 'AVAILABLE', { userId: 'u1' }, expect.anything());
  });

  it('rejects an illegal transition with a 409 AppError, not a generic 500', async () => {
    repo.findByIdWithPeople.mockResolvedValue({ id: 'm1', status: 'COMPLETED' } as any);
    const err = await service.start('m1', {}, { userId: 'u1' }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('Cannot start work order from status COMPLETED');
  });

  it('surfaces a missing work order as a 404 AppError', async () => {
    repo.findByIdWithPeople.mockResolvedValue(undefined);
    const err = await service.get('nope').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
  });

  it('validates files integration on start', async () => {
    repo.findByIdWithPeople.mockResolvedValue({ id: 'm1', status: 'OPEN' } as any);
    filesRepo.findById.mockResolvedValue(null);
    await expect(service.start('m1', { before_file_id: 'bad-id' }, { userId: 'u1' })).rejects.toThrow('Invalid before_file_id');
  });

  describe('assign', () => {
    it('rejects assigning to an unknown/inactive staff member (400)', async () => {
      repo.findByIdWithPeople.mockResolvedValue({ id: 'm1', status: 'OPEN' } as any);
      repo.isActiveUser.mockResolvedValue(false);
      const err = await service.assign('m1', { assigned_to: 'ghost' }, { userId: 'u1' }).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('assigns to an active staff member', async () => {
      repo.findByIdWithPeople.mockResolvedValue({ id: 'm1', status: 'OPEN' } as any);
      repo.isActiveUser.mockResolvedValue(true);
      repo.update.mockResolvedValue({ id: 'm1' } as any);
      await service.assign('m1', { assigned_to: 'kabelo' }, { userId: 'u1' });
      expect(repo.update).toHaveBeenCalledWith('m1', { assigned_to: 'kabelo' }, { userId: 'u1' });
    });

    it('allows clearing the assignment (null) without a user lookup', async () => {
      repo.findByIdWithPeople.mockResolvedValue({ id: 'm1', status: 'OPEN' } as any);
      repo.update.mockResolvedValue({ id: 'm1' } as any);
      await service.assign('m1', { assigned_to: null }, { userId: 'u1' });
      expect(repo.isActiveUser).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith('m1', { assigned_to: null }, { userId: 'u1' });
    });
  });

  describe('approve', () => {
    it('approves a completed order, stamping approved_by + approved_at', async () => {
      repo.findByIdWithPeople.mockResolvedValue({ id: 'm1', status: 'COMPLETED', approved_at: null } as any);
      repo.update.mockResolvedValue({ id: 'm1' } as any);
      await service.approve('m1', { userId: 'manager' });
      const [, fields] = repo.update.mock.calls[0]!;
      expect(fields.approved_by).toBe('manager');
      expect(fields.approved_at).toBeInstanceOf(Date);
    });

    it('refuses to approve an order that is not COMPLETED (409)', async () => {
      repo.findByIdWithPeople.mockResolvedValue({ id: 'm1', status: 'IN_PROGRESS', approved_at: null } as any);
      const err = await service.approve('m1', { userId: 'manager' }).catch((e) => e);
      expect(err.statusCode).toBe(409);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses to approve twice (409)', async () => {
      repo.findByIdWithPeople.mockResolvedValue({ id: 'm1', status: 'COMPLETED', approved_at: new Date() } as any);
      const err = await service.approve('m1', { userId: 'manager' }).catch((e) => e);
      expect(err.statusCode).toBe(409);
      expect(err.message).toContain('already been approved');
    });
  });
});
