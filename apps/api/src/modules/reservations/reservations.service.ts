import { ReservationsRepository } from './reservations.repository';
import type { ReservationRow, NewReservation, UpdateReservation } from '../../db/types';
import type { 
  ReservationFilters, 
  ReservationPaginationOptions, 
  PaginatedReservationResult, 
  ReservationRequestMeta, 
  CreateReservationDTO, 
  UpdateReservationDTO 
} from './reservations.types';

export class ReservationsService {
  constructor(private readonly repository: ReservationsRepository) {}

  async getReservationById(id: string): Promise<ReservationRow> {
    const reservation = await this.repository.findById(id);
    if (!reservation) {
      throw new Error(`Reservation with id ${id} not found`);
    }
    return reservation;
  }

  async getReservations(
    filters: ReservationFilters,
    pagination: ReservationPaginationOptions
  ): Promise<PaginatedReservationResult<ReservationRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async checkAvailability(roomId: string, checkIn: Date, checkOut: Date, excludeId?: string): Promise<boolean> {
    return this.repository.checkAvailability(roomId, checkIn, checkOut, excludeId);
  }

  async createReservation(dto: CreateReservationDTO, meta: ReservationRequestMeta): Promise<ReservationRow> {
    const checkIn = new Date(dto.check_in_date);
    const checkOut = new Date(dto.check_out_date);

    // Prevent check-in dates in past
    if (checkIn < new Date(new Date().setHours(0, 0, 0, 0))) {
      throw new Error('Cannot create reservation with check-in date in the past');
    }

    // Check availability
    const isAvailable = await this.checkAvailability(dto.room_id, checkIn, checkOut);
    if (!isAvailable) {
      throw new Error('Room is not available for the selected dates');
    }

    const newReservation: NewReservation = {
      ...dto,
      created_by: meta.userId,
      updated_by: meta.userId,
    };
    return this.repository.create(newReservation, meta);
  }

  async modifyReservation(id: string, dto: UpdateReservationDTO, meta: ReservationRequestMeta): Promise<ReservationRow> {
    const existing = await this.getReservationById(id);
    
    // Status transitions enforced
    if (dto.status && existing.status === 'CANCELLED' && dto.status !== 'CANCELLED') {
      throw new Error('Cannot modify a cancelled reservation');
    }
    if (dto.status && existing.status === 'CHECKED_OUT' && dto.status !== 'CHECKED_OUT') {
      throw new Error('Cannot modify a checked out reservation');
    }

    const checkIn = dto.check_in_date ? new Date(dto.check_in_date) : existing.check_in_date;
    const checkOut = dto.check_out_date ? new Date(dto.check_out_date) : existing.check_out_date;
    const roomId = dto.room_id || existing.room_id;

    if (checkIn >= checkOut) {
      throw new Error('Check-out date must be after check-in date');
    }

    // Re-check availability if dates or room changed
    if (dto.check_in_date || dto.check_out_date || dto.room_id) {
      const isAvailable = await this.checkAvailability(roomId, checkIn, checkOut, id);
      if (!isAvailable) {
        throw new Error('Room is not available for the updated dates/room');
      }
    }
    
    const updatePayload: UpdateReservation = {
      ...dto,
      updated_by: meta.userId,
    };
    
    const updated = await this.repository.update(id, updatePayload, meta);
    if (!updated) {
      throw new Error(`Failed to update reservation with id ${id}`);
    }
    return updated;
  }

  async cancelReservation(id: string, meta: ReservationRequestMeta): Promise<ReservationRow> {
    const existing = await this.getReservationById(id);

    if (['CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'].includes(existing.status)) {
      throw new Error(`Cannot cancel reservation with status ${existing.status}`);
    }

    const updated = await this.repository.update(
      id, 
      { status: 'CANCELLED', updated_by: meta.userId }, 
      meta
    );

    if (!updated) {
      throw new Error(`Failed to cancel reservation with id ${id}`);
    }
    return updated;
  }
}
