import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from '../../../src/modules/users/users.service';
import { UsersRepository } from '../../../src/modules/users/users.repository';

const meta = { userId: 'acting-admin', ip: '127.0.0.1', requestId: 'req1' };

const adminUser = {
  id: 'u-admin',
  name: 'Tameem Khan',
  email: 'tameem@lsp.local',
  role: 'admin' as const,
  active: true,
  is_lead: false,
  extra_permissions: [],
  property_ids: [],
  created_at: new Date(),
  updated_at: new Date(),
};

describe('UsersService', () => {
  let service: UsersService;
  let repository: vi.Mocked<UsersRepository>;

  beforeEach(() => {
    repository = {
      listAll: vi.fn(),
      findById: vi.fn(),
      emailExists: vi.fn(),
      findRoleByName: vi.fn(),
      listRoles: vi.fn(),
      findPermissionsByNames: vi.fn(),
      findPropertiesByIds: vi.fn(),
      countOtherActiveAdmins: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      resetPassword: vi.fn(),
    } as unknown as vi.Mocked<UsersRepository>;

    service = new UsersService(repository);
  });

  describe('createUser', () => {
    it('rejects a duplicate email with 409', async () => {
      repository.emailExists.mockResolvedValue(true);

      await expect(
        service.createUser(
          { name: 'X', email: 'tameem@lsp.local', password: 'Pass@123!', role: 'accounts', is_lead: false, extra_permissions: [] },
          meta
        )
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('rejects unknown extra permissions with 400', async () => {
      repository.emailExists.mockResolvedValue(false);
      repository.findRoleByName.mockResolvedValue({ id: 6, name: 'housekeeping' });
      repository.findPermissionsByNames.mockResolvedValue([]); // none of the names exist

      await expect(
        service.createUser(
          { name: 'X', email: 'x@lsp.local', password: 'Pass@123!', role: 'housekeeping', is_lead: false, extra_permissions: ['not.a.permission'] },
          meta
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('creates a user with hashed password and extra grants', async () => {
      repository.emailExists.mockResolvedValue(false);
      repository.findRoleByName.mockResolvedValue({ id: 6, name: 'housekeeping' });
      repository.findPermissionsByNames.mockResolvedValue([
        { id: 41, name: 'reservations.read' },
        { id: 55, name: 'housekeeping.inspect' },
      ]);
      repository.create.mockResolvedValue('new-id');
      repository.findById.mockResolvedValue({ ...adminUser, id: 'new-id', role: 'housekeeping' as any });

      const user = await service.createUser(
        {
          name: 'Lorato Bakwena',
          email: 'lorato@lsp.local',
          password: 'Clean@123!',
          role: 'housekeeping',
          is_lead: true,
          extra_permissions: ['reservations.read', 'housekeeping.inspect'],
        },
        meta
      );

      expect(user.id).toBe('new-id');
      const [input, extraIds] = repository.create.mock.calls[0]!;
      expect(input.password_hash).not.toBe('Clean@123!'); // bcrypt, never plaintext
      expect(input.is_lead).toBe(true);
      expect(extraIds).toEqual([41, 55]);
    });

    it('validates and forwards property_ids to the repository', async () => {
      repository.emailExists.mockResolvedValue(false);
      repository.findRoleByName.mockResolvedValue({ id: 3, name: 'reception' });
      repository.findPermissionsByNames.mockResolvedValue([]);
      repository.findPropertiesByIds.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      repository.create.mockResolvedValue('uid');
      repository.findById.mockResolvedValue(adminUser);

      await service.createUser(
        { name: 'X', email: 'x@lsp.local', password: 'Pass@123!', role: 'reception', is_lead: false, extra_permissions: [], property_ids: ['p1', 'p2'] } as any,
        meta
      );

      // create(input, extraIds, propertyIds, meta) — propertyIds is the 3rd arg.
      expect(repository.create.mock.calls[0]![2]).toEqual(['p1', 'p2']);
    });

    it('rejects unknown property_ids', async () => {
      repository.emailExists.mockResolvedValue(false);
      repository.findRoleByName.mockResolvedValue({ id: 3, name: 'reception' });
      repository.findPermissionsByNames.mockResolvedValue([]);
      repository.findPropertiesByIds.mockResolvedValue([{ id: 'p1' }]); // p2 doesn't exist

      await expect(
        service.createUser(
          { name: 'X', email: 'x@lsp.local', password: 'Pass@123!', role: 'reception', is_lead: false, extra_permissions: [], property_ids: ['p1', 'p2'] } as any,
          meta
        )
      ).rejects.toThrow('Unknown properties');
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('updateUser — safety invariants', () => {
    it('blocks deactivating the LAST active admin (409)', async () => {
      repository.findById.mockResolvedValue(adminUser);
      repository.countOtherActiveAdmins.mockResolvedValue(0);

      await expect(
        service.updateUser('u-admin', { active: false }, { ...meta, userId: 'someone-else' })
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('blocks demoting the LAST active admin out of admin (409)', async () => {
      repository.findById.mockResolvedValue(adminUser);
      repository.countOtherActiveAdmins.mockResolvedValue(0);

      await expect(
        service.updateUser('u-admin', { role: 'accounts' }, { ...meta, userId: 'someone-else' })
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('blocks self-deactivation even when other admins exist (400)', async () => {
      repository.findById.mockResolvedValue(adminUser);
      repository.countOtherActiveAdmins.mockResolvedValue(3);

      await expect(
        service.updateUser('u-admin', { active: false }, { ...meta, userId: 'u-admin' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('blocks self-demotion out of admin (400)', async () => {
      repository.findById.mockResolvedValue(adminUser);
      repository.countOtherActiveAdmins.mockResolvedValue(3);

      await expect(
        service.updateUser('u-admin', { role: 'operations' }, { ...meta, userId: 'u-admin' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('allows demoting an admin when another active admin remains', async () => {
      repository.findById.mockResolvedValue(adminUser);
      repository.countOtherActiveAdmins.mockResolvedValue(1);
      repository.findRoleByName.mockResolvedValue({ id: 2, name: 'operations' });

      await service.updateUser('u-admin', { role: 'operations' }, { ...meta, userId: 'someone-else' });

      expect(repository.update).toHaveBeenCalledWith(
        'u-admin',
        expect.objectContaining({ role_id: 2 }),
        undefined,
        undefined,
        expect.anything()
      );
    });
  });

  describe('resetPassword', () => {
    it('404s for a missing user before doing any hashing', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.resetPassword('ghost', { password: 'Newpass@1' }, meta)
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(repository.resetPassword).not.toHaveBeenCalled();
    });

    it('stores a hash, never the plaintext', async () => {
      repository.findById.mockResolvedValue(adminUser);

      await service.resetPassword('u-admin', { password: 'Newpass@1' }, meta);

      const [, hash] = repository.resetPassword.mock.calls[0]!;
      expect(hash).not.toBe('Newpass@1');
      expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt format
    });
  });
});
