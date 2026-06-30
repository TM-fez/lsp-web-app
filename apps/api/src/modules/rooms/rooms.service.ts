import { RoomsRepository } from './rooms.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { RoomRow, NewRoom, UpdateRoom } from '../../db/types.js';
import type {
  RoomFilters,
  RoomPaginationOptions,
  PaginatedRoomResult,
  RoomRequestMeta,
  RoomListRow,
  CreateRoomDTO,
  UpdateRoomDTO,
} from './rooms.types.js';

export class RoomsService {
  constructor(private readonly repository: RoomsRepository) {}

  async getRoomById(id: string): Promise<RoomRow> {
    const room = await this.repository.findById(id);
    if (!room) {
      throw AppError.notFound(`Room with id ${id} not found`);
    }
    return room;
  }

  async getRooms(
    filters: RoomFilters,
    pagination: RoomPaginationOptions
  ): Promise<PaginatedRoomResult<RoomListRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async listAvailable(propertyId?: string): Promise<RoomRow[]> {
    return this.repository.listAvailable(propertyId);
  }

  async createRoom(dto: CreateRoomDTO, meta: RoomRequestMeta): Promise<RoomRow> {
    const existing = await this.repository.findByCode(dto.code);
    if (existing) {
      throw AppError.conflict(`Room code "${dto.code}" is already in use`);
    }

    const newRoom: NewRoom = {
      ...dto,
      created_by: meta.userId,
      updated_by: meta.userId,
    };
    return this.repository.create(newRoom, meta);
  }

  async updateRoom(id: string, dto: UpdateRoomDTO, meta: RoomRequestMeta): Promise<RoomRow> {
    await this.getRoomById(id);

    if (dto.code) {
      const existing = await this.repository.findByCode(dto.code);
      if (existing && existing.id !== id) {
        throw AppError.conflict(`Room code "${dto.code}" is already in use`);
      }
    }

    const updatePayload: UpdateRoom = {
      ...dto,
      updated_by: meta.userId,
    };

    const updated = await this.repository.update(id, updatePayload, meta);
    if (!updated) {
      throw AppError.notFound(`Failed to update room with id ${id}`);
    }
    return updated;
  }

  async setMaintenance(id: string, meta: RoomRequestMeta): Promise<RoomRow> {
    const room = await this.getRoomById(id);

    // An occupied room cannot be put into maintenance.
    if (room.status === 'OCCUPIED') {
      throw AppError.conflict('Cannot set an occupied room to maintenance');
    }

    return this.applyStatus(id, 'MAINTENANCE', meta);
  }

  async setOutOfService(id: string, meta: RoomRequestMeta): Promise<RoomRow> {
    const room = await this.getRoomById(id);

    if (room.status === 'OCCUPIED') {
      throw AppError.conflict('Cannot take an occupied room out of service');
    }

    return this.applyStatus(id, 'OUT_OF_SERVICE', meta);
  }

  async restoreRoom(id: string, meta: RoomRequestMeta): Promise<RoomRow> {
    await this.getRoomById(id);
    return this.applyStatus(id, 'AVAILABLE', meta);
  }

  async deleteRoom(id: string, meta: RoomRequestMeta): Promise<void> {
    await this.getRoomById(id);

    const success = await this.repository.softDelete(id, meta);
    if (!success) {
      throw AppError.notFound(`Failed to delete room with id ${id}`);
    }
  }

  private async applyStatus(
    id: string,
    status: RoomRow['status'],
    meta: RoomRequestMeta
  ): Promise<RoomRow> {
    const updated = await this.repository.update(id, { status, updated_by: meta.userId }, meta);
    if (!updated) {
      throw AppError.notFound(`Failed to update room with id ${id}`);
    }
    return updated;
  }
}
