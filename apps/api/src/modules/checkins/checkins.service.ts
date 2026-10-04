import { todayInPropertyTZ } from '../../core/time.js';
import { CheckinsRepository } from './checkins.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import { logger } from '../../core/logger.js';
import type { OccupancyRow } from '../../db/types.js';
import type {
  OccupancyFilters,
  OccupancyPaginationOptions,
  PaginatedOccupancyResult,
  OccupancyRequestMeta,
  CreateCheckInDTO,
  CheckOutDTO,
} from './checkins.types.js';

/** The one thing check-in/out needs from the money side — see ReservationsService.ensureReceivable. */
export interface ReceivableEnsurer {
  ensureReceivable(reservationId: string, meta: OccupancyRequestMeta): Promise<void>;
}

export class CheckinsService {
  // `receivables` is optional so unit tests can build the service with a repository alone.
  constructor(
    private readonly repository: CheckinsRepository,
    private readonly receivables?: ReceivableEnsurer,
  ) {}

  /**
   * A guest in the house (or just out of it) who owes money must be on the books as
   * owing it: an unpaid stay that was never invoiced — pay-later, a walk-in — is exactly
   * the debt nobody chases. Best-effort by design: refusing to check a guest in or out
   * because the accounting hiccuped would be the wrong trade, and the next touch (or the
   * backfill) reconciles anything missed.
   */
  private async keepReceivable(reservationId: string, meta: OccupancyRequestMeta): Promise<void> {
    if (!this.receivables) return;
    try {
      await this.receivables.ensureReceivable(reservationId, meta);
    } catch (err) {
      logger.error({ err, reservationId }, '[checkins] could not reconcile the receivable');
    }
  }

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

    // A guest at the door may check in whether or not they have paid (owner decision
    // 2026-09-07, amending invariant 3). Some clients settle after the stay, and
    // refusing them at the desk did not collect the money — it just meant the booking
    // never got made, so the room they slept in read as free to everyone else.
    //
    // A WHITELIST, not a status test, so a new reservation status has to be considered
    // here rather than silently inheriting the right to check in.
    if (reservation.status !== 'PENDING' && reservation.status !== 'CONFIRMED') {
      throw AppError.conflict(
        reservation.status === 'BLOCKED'
          ? 'This is an imported Booking.com block — claim it to a guest before checking them in.'
          : reservation.status === 'CHECKED_IN'
            ? 'This guest is already checked in.'
            : `A ${reservation.status.toLowerCase().replace('_', ' ')} booking cannot be checked in.`
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

    // (Re-test round 3) Check-in accepted anything: a check-in 40 days before the stay, a
    // time far in the past, 500 guests in a 2-person unit. Arrival may be a day early
    // (late-night arrivals, early check-in), never after the stay has ended.
    const today = todayInPropertyTZ();
    if (today < addDays(reservation.check_in_day, -1)) {
      throw AppError.conflict(`This stay starts on ${reservation.check_in_day} — check the guest in on arrival.`);
    }
    if (today >= reservation.check_out_day) {
      throw AppError.conflict('This stay has already ended — it can no longer be checked in.');
    }
    if (dto.checked_in_at) {
      const at = todayInPropertyTZ(dto.checked_in_at);
      if (at > today) throw AppError.badRequest('The check-in time can’t be in the future.');
      if (at < addDays(reservation.check_in_day, -1)) {
        throw AppError.badRequest('The check-in time is before this stay begins.');
      }
    }
    if (room.capacity != null && dto.guest_count > room.capacity) {
      throw AppError.badRequest(`This unit sleeps ${room.capacity}. Check the number of guests.`);
    }

    let occupancy: OccupancyRow;
    try {
      occupancy = await this.repository.checkIn(
        {
          reservationId: reservation.id,
          roomId: reservation.room_id,
          guestCount: dto.guest_count,
          notes: dto.notes ?? null,
          checkedInAt: dto.checked_in_at,
        },
        meta
      );
    } catch (err) {
      // Two check-ins at once: the occupancy unique indexes let one through (re-test 3:
      // the loser used to get a 500).
      if ((err as { code?: string })?.code === '23505') {
        throw AppError.conflict('This guest has just been checked in, or the unit was just taken. Refresh to see the latest.');
      }
      throw err;
    }
    await this.keepReceivable(reservation.id, meta);
    return occupancy;
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
    await this.keepReceivable(occupancy.reservation_id, meta);
    return updated;
  }
}

/** YYYY-MM-DD shifted by whole days (calendar arithmetic, no timezone involved). */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
