import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FilesService, LocalStorageDriver } from '../../../src/modules/files/files.service.js';
import { FilesRepository } from '../../../src/modules/files/files.repository.js';
import { Readable } from 'node:stream';

describe('FilesService', () => {
  let service: FilesService;
  let repository: vi.Mocked<FilesRepository>;
  let adapter: vi.Mocked<LocalStorageDriver>;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      findById: vi.fn(),
      findByChecksum: vi.fn(),
      findPaginated: vi.fn(),
      listByOwner: vi.fn(),
      softDelete: vi.fn(),
    } as unknown as vi.Mocked<FilesRepository>;

    adapter = {
      save: vi.fn(),
      delete: vi.fn(),
      getUrl: vi.fn(),
      getStream: vi.fn(),
    } as unknown as vi.Mocked<LocalStorageDriver>;

    service = new FilesService(repository, adapter);
  });

  describe('upload', () => {
    it('should throw for disallowed mime type', async () => {
      const stream = new Readable();
      await expect(service.upload(stream, 'test.exe', 'application/x-msdownload', 100, false, {} as any))
        .rejects.toThrow('Disallowed MIME type');
    });

    it('should throw for size exceeding limit', async () => {
      const stream = new Readable();
      await expect(service.upload(stream, 'big.pdf', 'application/pdf', 999999999, false, {} as any))
        .rejects.toThrow('File size exceeds limit');
    });

    it('should prevent duplicate storage via checksum but create new row', async () => {
      // Mock an existing file
      repository.findByChecksum.mockResolvedValue({ id: 'existing-id', path: 'old/path.pdf', stored_name: 'xyz.pdf', storage_driver: 'local', bucket: null } as any);
      repository.create.mockResolvedValue({ id: 'new-id' } as any);
      
      const stream = new Readable({
        read() {
          this.push('dummy data');
          this.push(null);
        }
      });
      
      const res = await service.upload(stream, 'test.pdf', 'application/pdf', 10, false, {} as any);
      expect(res.id).toBe('new-id');
      expect(repository.create).toHaveBeenCalled();
      expect(adapter.save).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should soft delete only', async () => {
      repository.findById.mockResolvedValue({ id: 'f1', path: 'some/path' } as any);
      await service.delete('f1', { userId: 'u1' });
      expect(repository.softDelete).toHaveBeenCalledWith('f1', { userId: 'u1' });
      expect(adapter.delete).not.toHaveBeenCalled(); // Preserving binary
    });
  });
});
