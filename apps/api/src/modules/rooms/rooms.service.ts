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
  UpdateChannelConfigDTO,
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
    // Code must be unique within its building (block), not globally — see migration 051.
    const existing = await this.repository.findByCodeInBuilding(dto.code, dto.building_id ?? null);
    if (existing) {
      throw AppError.conflict(`Room code "${dto.code}" is already in use in this building`);
    }

    const newRoom: NewRoom = {
      ...dto,
      created_by: meta.userId,
      updated_by: meta.userId,
    };
    return this.repository.create(newRoom, meta);
  }

  /**
   * Channel sync config (H4): set/clear where this unit's Booking.com calendar is
   * pulled from. The URL is validated (https + booking.com host) at the schema, so
   * the server-side importer can never be pointed at an arbitrary endpoint.
   */
  async setChannelConfig(id: string, dto: UpdateChannelConfigDTO, meta: RoomRequestMeta): Promise<RoomRow> {
    await this.getRoomById(id);
    const updated = await this.repository.update(
      id,
      { booking_ical_url: dto.booking_ical_url, updated_by: meta.userId },
      meta,
    );
    if (!updated) throw AppError.notFound(`Room with id ${id} not found`);
    return updated;
  }

  /** Mint a fresh export-feed token; the old feed URL stops working immediately. */
  async rotateIcalToken(id: string, meta: RoomRequestMeta): Promise<RoomRow> {
    await this.getRoomById(id);
    const updated = await this.repository.rotateIcalToken(id, meta);
    if (!updated) throw AppError.notFound(`Room with id ${id} not found`);
    return updated;
  }

  async rotateGuestToken(id: string, meta: RoomRequestMeta): Promise<RoomRow> {
    await this.getRoomById(id);
    const updated = await this.repository.rotateGuestToken(id, meta);
    if (!updated) throw AppError.notFound(`Room with id ${id} not found`);
    return updated;
  }

  async updateRoom(id: string, dto: UpdateRoomDTO, meta: RoomRequestMeta): Promise<RoomRow> {
    const current = await this.getRoomById(id);

    // Re-check uniqueness if the code or the building (which scopes it) changes.
    if (dto.code !== undefined || dto.building_id !== undefined) {
      const code = dto.code ?? current.code;
      const buildingId = dto.building_id !== undefined ? dto.building_id : current.building_id;
      const existing = await this.repository.findByCodeInBuilding(code, buildingId ?? null);
      if (existing && existing.id !== id) {
        throw AppError.conflict(`Room code "${code}" is already in use in this building`);
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
