import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import type { UsersRepository } from './users.repository.js';
import type {
  CreateUserDTO,
  ResetPasswordDTO,
  RoleInfo,
  StaffUser,
  UpdateUserDTO,
  UsersRequestMeta,
} from './users.types.js';

export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async listUsers(): Promise<StaffUser[]> {
    return this.repository.listAll();
  }

  async listRoles(): Promise<RoleInfo[]> {
    return this.repository.listRoles();
  }

  async listDirectory() {
    return this.repository.listDirectory();
  }

  async getUserById(id: string): Promise<StaffUser> {
    const user = await this.repository.findById(id);
    if (!user) throw AppError.notFound(`User with id ${id} not found`);
    return user;
  }

  /** Resolve extra permission names to ids, rejecting unknown names outright. */
  private async resolveExtraPermissions(names: string[]): Promise<number[]> {
    const unique = [...new Set(names)];
    const found = await this.repository.findPermissionsByNames(unique);
    if (found.length !== unique.length) {
      const known = new Set(found.map((p) => p.name));
      const unknown = unique.filter((n) => !known.has(n));
      throw AppError.badRequest(`Unknown permissions: ${unknown.join(', ')}`);
    }
    return found.map((p) => p.id);
  }

  async createUser(dto: CreateUserDTO, meta: UsersRequestMeta): Promise<StaffUser> {
    if (await this.repository.emailExists(dto.email)) {
      throw AppError.conflict(`A user with email ${dto.email} already exists`);
    }

    const role = await this.repository.findRoleByName(dto.role);
    if (!role) throw AppError.badRequest(`Unknown role: ${dto.role}`);

    const extraIds = await this.resolveExtraPermissions(dto.extra_permissions);
    const password_hash = await bcrypt.hash(dto.password, env.BCRYPT_ROUNDS);

    const id = await this.repository.create(
      { name: dto.name, email: dto.email, password_hash, role_id: role.id, is_lead: dto.is_lead },
      extraIds,
      meta
    );

    return this.getUserById(id);
  }

  async updateUser(id: string, dto: UpdateUserDTO, meta: UsersRequestMeta): Promise<StaffUser> {
    const target = await this.getUserById(id);

    const demotingFromAdmin = target.role === 'admin' && dto.role !== undefined && dto.role !== 'admin';
    const deactivating = dto.active === false && target.active;

    // Acting on yourself: you cannot lock yourself out or drop your own admin access.
    if (meta.userId === id) {
      if (deactivating) throw AppError.badRequest('You cannot deactivate your own account');
      if (demotingFromAdmin) throw AppError.badRequest('You cannot remove your own admin access');
    }

    // The system must always keep at least one active admin.
    if (target.role === 'admin' && target.active && (deactivating || demotingFromAdmin)) {
      const others = await this.repository.countOtherActiveAdmins(id);
      if (others === 0) {
        throw AppError.conflict('Cannot remove or deactivate the last active admin');
      }
    }

    let role_id: number | undefined;
    if (dto.role !== undefined) {
      const role = await this.repository.findRoleByName(dto.role);
      if (!role) throw AppError.badRequest(`Unknown role: ${dto.role}`);
      role_id = role.id;
    }

    const extraIds =
      dto.extra_permissions !== undefined
        ? await this.resolveExtraPermissions(dto.extra_permissions)
        : undefined;

    await this.repository.update(
      id,
      { name: dto.name, role_id, active: dto.active, is_lead: dto.is_lead },
      extraIds,
      meta
    );

    return this.getUserById(id);
  }

  async resetPassword(id: string, dto: ResetPasswordDTO, meta: UsersRequestMeta): Promise<void> {
    await this.getUserById(id); // 404 before hashing work
    const hash = await bcrypt.hash(dto.password, env.BCRYPT_ROUNDS);
    await this.repository.resetPassword(id, hash, meta);
  }
}
