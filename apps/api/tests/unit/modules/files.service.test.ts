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
      name: 'local',
      bucket: null,
      save: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn().mockResolvedValue(true),
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
      // Mock an existing file whose binary is still present
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
      expect(adapter.exists).toHaveBeenCalledWith('old/path.pdf');
      expect(adapter.save).not.toHaveBeenCalled();
    });

    it('re-writes the binary when the dedupe row exists but the bytes are gone', async () => {
      // The row survived a redeploy; the ephemeral disk did not.
      repository.findByChecksum.mockResolvedValue({ id: 'existing-id', path: 'old/path.pdf', stored_name: 'xyz.pdf', storage_driver: 'local', bucket: null } as any);
      repository.create.mockResolvedValue({ id: 'new-id' } as any);
      (adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const stream = new Readable({
        read() {
          this.push('dummy data');
          this.push(null);
        }
      });

      await service.upload(stream, 'test.pdf', 'application/pdf', 10, false, {} as any);
      expect(adapter.save).toHaveBeenCalledWith(expect.anything(), 'old/path.pdf', expect.any(Number));
    });

    it('records the ACTIVE driver on the new row, not the original upload driver', async () => {
      repository.findByChecksum.mockResolvedValue(null as any);
      repository.create.mockImplementation(async (row: any) => row);

      const stream = new Readable({
        read() {
          this.push('dummy data');
          this.push(null);
        }
      });

      const row: any = await service.upload(stream, 'test.pdf', 'application/pdf', 10, false, {} as any);
      expect(row.storage_driver).toBe('local');
      expect(adapter.save).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(Number));
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
