import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactsService } from '../../../../src/modules/crm/contacts/contacts.service';
import { ContactsRepository } from '../../../../src/modules/crm/contacts/contacts.repository';

describe('ContactsService', () => {
  let service: ContactsService;
  let repository: vi.Mocked<ContactsRepository>;

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      findPaginated: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
    } as unknown as vi.Mocked<ContactsRepository>;

    service = new ContactsService(repository);
  });

  describe('getContactById', () => {
    it('should return contact if found', async () => {
      const mockContact = { id: '1', name: 'John Doe' };
      repository.findById.mockResolvedValue(mockContact as any);

      const result = await service.getContactById('1');
      expect(result).toEqual(mockContact);
      expect(repository.findById).toHaveBeenCalledWith('1');
    });

    it('should throw error if contact not found', async () => {
      repository.findById.mockResolvedValue(undefined);

      await expect(service.getContactById('1')).rejects.toThrow('Contact with id 1 not found');
    });
  });

  describe('createContact', () => {
    it('should create and return a contact', async () => {
      const dto = { type: 'individual' as const, name: 'Alice' };
      const meta = { userId: 'user-1', ip: '127.0.0.1', requestId: 'req-1' };
      const mockCreated = { id: '1', ...dto, created_by: 'user-1' };
      
      repository.create.mockResolvedValue(mockCreated as any);

      const result = await service.createContact(dto, meta);
      
      expect(result).toEqual(mockCreated);
      expect(repository.create).toHaveBeenCalledWith(
        { ...dto, created_by: 'user-1', updated_by: 'user-1' },
        meta
      );
    });
  });
});
