import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeadsService } from '../../../../src/modules/crm/leads/leads.service';
import { LeadsRepository } from '../../../../src/modules/crm/leads/leads.repository';

describe('LeadsService', () => {
  let service: LeadsService;
  let repository: vi.Mocked<LeadsRepository>;

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      findPaginated: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
    } as unknown as vi.Mocked<LeadsRepository>;

    // convertLead is the only method that touches reservations; a stub keeps these
    // CRUD tests independent of it.
    const reservations = { createReservation: vi.fn() } as unknown as import('../../../../src/modules/reservations/reservations.service').ReservationsService;
    service = new LeadsService(repository, reservations);
  });

  describe('getLeadById', () => {
    it('should return lead if found', async () => {
      const mockLead = { id: '1', title: 'Big Deal' };
      repository.findById.mockResolvedValue(mockLead as any);

      const result = await service.getLeadById('1');
      expect(result).toEqual(mockLead);
      expect(repository.findById).toHaveBeenCalledWith('1');
    });

    it('should throw error if lead not found', async () => {
      repository.findById.mockResolvedValue(undefined);

      await expect(service.getLeadById('1')).rejects.toThrow('Lead with id 1 not found');
    });
  });

  describe('createLead', () => {
    it('should create and return a lead', async () => {
      const dto = { title: 'New Opp', status: 'NEW' as const };
      const meta = { userId: 'user-1', ip: '127.0.0.1', requestId: 'req-1' };
      const mockCreated = { id: '1', ...dto, created_by: 'user-1' };
      
      repository.create.mockResolvedValue(mockCreated as any);

      const result = await service.createLead(dto, meta);
      
      expect(result).toEqual(mockCreated);
      expect(repository.create).toHaveBeenCalledWith(
        { ...dto, created_by: 'user-1', updated_by: 'user-1' },
        meta
      );
    });
  });
});
