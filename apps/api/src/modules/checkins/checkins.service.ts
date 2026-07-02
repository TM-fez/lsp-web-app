import { CheckinsRepository } from './checkins.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { OccupancyRow } from '../../db/types.js';
import type {
  OccupancyFilters,
  OccupancyPaginationOptions,
  PaginatedOccupancyResult,
  OccupancyRequestMeta,
  CreateCheckInDTO,
  CheckOutDTO,
} from './checkins.types.js';

export class CheckinsService {
  constructor(private readonly repository: CheckinsRepository) {}

  async getOccupancyById(id: string): Promise<OccupancyRow> {
    const occupancy = await this.repository.findById(id);
    if (!occupancy) {
      throw AppError.notFound(`Occupancy with id ${id} not found`);
    }
    return occupancy;
  }

  async listOccupancy(
    filters: OccupancyFilters,
    pagination: OccupancyPaginationOptions
  ): Promise<PaginatedOccupancyResult<OccupancyRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async listActive(propertyId?: string): Promise<OccupancyRow[]> {
    return this.repository.findActive(propertyId);
  }

  async checkIn(dto: CreateCheckInDTO, meta: OccupancyRequestMeta): Promise<OccupancyRow> {
    const reservation = await this.repository.findReservation(dto.reservation_id);
    if (!reservation) {
      throw AppError.notFound(`Reservation with id ${dto.reservation_id} not found`);
    }

    // Only a confirmed reservation may check in.
    if (reservation.status !== 'CONFIRMED') {
      throw AppError.conflict(
        `Reservation must be CONFIRMED to check in (current status: ${reservation.status})`
      );
    }

    const room = await this.repository.findRoom(reservation.room_id);
    if (!room) {
      throw AppError.conflict('Reservation room no longer exists');
    }

    // Room must be available — this also prevents double occupancy.
    if (room.status !== 'AVAILABLE') {
      throw AppError.conflict(`Room is not available for check-in (current status: ${room.status})`);
    }

    // Readiness gate: a vacated-but-not-yet-cleaned unit cannot take a guest.
    if (room.housekeeping_status !== 'READY') {
      throw AppError.conflict(
        `Room is not ready for check-in (housekeeping status: ${room.housekeeping_status})`
      );
    }

    return this.repository.checkIn(
      {
        reservationId: reservation.id,
        roomId: reservation.room_id,
        guestCount: dto.guest_count,
        notes: dto.notes ?? null,
        checkedInAt: dto.checked_in_at,
      },
      meta
    );
  }

  async checkOut(occupancyId: string, dto: CheckOutDTO, meta: OccupancyRequestMeta): Promise<OccupancyRow> {
    const occupancy = await this.getOccupancyById(occupancyId);

    if (occupancy.status === 'CHECKED_OUT') {
      throw AppError.conflict('Occupancy has already been checked out');
    }

    const checkedOutAt = dto.checked_out_at ?? new Date();
    if (checkedOutAt < occupancy.checked_in_at) {
      throw AppError.badRequest('Cannot check out before check-in time');
    }

    const updated = await this.repository.checkOut(
      occupancy.id,
      occupancy.reservation_id,
      occupancy.room_id,
      checkedOutAt,
      dto.notes,
      meta
    );
    if (!updated) {
      throw AppError.notFound(`Failed to check out occupancy with id ${occupancyId}`);
    }
    return updated;
  }
}
