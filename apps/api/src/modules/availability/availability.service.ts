import { AvailabilityRepository } from './availability.repository.js';
import type { 
  AvailabilityQueryDTO, 
  AvailabilityCalendarDTO, 
  AvailabilityQuoteDTO, 
  AvailabilityResult, 
  AvailableRoomsResult, 
  CalendarDay, 
  QuoteResult, 
  AvailabilityStatus,
  BlockReason,
  RoomVerdict
} from './availability.types.js';

export class AvailabilityService {
  constructor(private readonly repository: AvailabilityRepository) {}

  private determineRoomVerdict(
    status: string,
    activeOccupancy: number,
    overlappingReservations: number
  ): { available: boolean; reason: BlockReason | null } {
    if (status === 'MAINTENANCE') return { available: false, reason: 'MAINTENANCE' };
    if (status === 'OUT_OF_SERVICE') return { available: false, reason: 'OUT_OF_SERVICE' };
    if (status === 'OCCUPIED' || activeOccupancy > 0) return { available: false, reason: 'OCCUPIED' };
    if (overlappingReservations > 0) return { available: false, reason: 'RESERVED' };
    return { available: true, reason: null };
  }

  private deriveStatus(free: number, total: number): AvailabilityStatus {
    if (free === 0) return 'BLOCKED'; // or FULL if no structural blocks? Wait, FULL is typical. 
    if (free === total) return 'AVAILABLE';
    if (free < total * 0.2) return 'LIMITED';
    return 'AVAILABLE';
  }

  async getRoomAvailability(query: AvailabilityQueryDTO, propertyId?: string): Promise<AvailabilityResult> {
    const minCapacity = Math.max(query.guests || 0, query.capacity || 0);
    const filters = { roomType: query.room_type, minCapacity, propertyId };
    const range = { checkIn: query.check_in, checkOut: query.check_out };
    
    const signals = await this.repository.findRoomSignals(
      range, 
      filters, 
      { page: query.page, limit: query.limit }, 
      false
    );

    const total = signals.length > 0 ? signals[0].total_count : 0;
    const rooms: RoomVerdict[] = signals.map(sig => {
      const { available, reason } = this.determineRoomVerdict(
        sig.status, 
        sig.active_occupancy, 
        sig.overlapping_reservations
      );
      return {
        id: sig.id,
        name: sig.name,
        code: sig.code,
        type: sig.type,
        capacity: sig.capacity,
        room_status: sig.status,
        available,
        reason
      };
    });

    return {
      range: { check_in: range.checkIn.toISOString().split('T')[0], check_out: range.checkOut.toISOString().split('T')[0] },
      page: query.page,
      limit: query.limit,
      total,
      rooms
    };
  }

  async getAvailableRooms(query: AvailabilityQueryDTO, propertyId?: string): Promise<AvailableRoomsResult> {
    const minCapacity = Math.max(query.guests || 0, query.capacity || 0);
    const filters = { roomType: query.room_type, minCapacity, propertyId };
    const range = { checkIn: query.check_in, checkOut: query.check_out };
    
    const signals = await this.repository.findRoomSignals(
      range, 
      filters, 
      { page: query.page, limit: query.limit }, 
      true
    );

    const total = signals.length > 0 ? signals[0].total_count : 0;
    const data: RoomVerdict[] = signals.map(sig => ({
      id: sig.id,
      name: sig.name,
      code: sig.code,
      type: sig.type,
      capacity: sig.capacity,
      room_status: sig.status,
      available: true,
      reason: null
    }));

    return {
      range: { check_in: range.checkIn.toISOString().split('T')[0], check_out: range.checkOut.toISOString().split('T')[0] },
      page: query.page,
      limit: query.limit,
      total,
      data
    };
  }

  async getQuote(query: AvailabilityQuoteDTO, propertyId?: string): Promise<QuoteResult> {
    const minCapacity = Math.max(query.guests || 0, query.capacity || 0);
    const filters = { roomType: query.room_type, minCapacity, propertyId };
    const range = { checkIn: query.check_in, checkOut: query.check_out };
    
    const counts = await this.repository.getSummaryCounts(range, filters);
    const blockedRooms = counts.maintenance + counts.out_of_service + counts.occupied + counts.reserved;
    
    // Status resolution based on free count
    let status: AvailabilityStatus = 'AVAILABLE';
    if (counts.available === 0) status = 'FULL';
    else if (counts.available < counts.total * 0.2) status = 'LIMITED';

    return {
      range: { check_in: range.checkIn.toISOString().split('T')[0], check_out: range.checkOut.toISOString().split('T')[0] },
      status,
      total_rooms: counts.total,
      available_rooms: counts.available,
      blocked_rooms: blockedRooms,
      occupancy_rate: counts.total > 0 ? (counts.occupied + counts.reserved) / counts.total : 0,
      breakdown: {
        maintenance: counts.maintenance,
        out_of_service: counts.out_of_service,
        occupied: counts.occupied,
        reserved: counts.reserved,
      }
    };
  }

  async getCalendar(query: AvailabilityCalendarDTO, propertyId?: string): Promise<CalendarDay[]> {
    const minCapacity = query.capacity || 0;
    const filters = { roomType: query.room_type, minCapacity, propertyId };
    const range = { checkIn: query.check_in, checkOut: query.check_out };
    
    const dayRows = await this.repository.getCalendar(range, filters);
    
    return dayRows.map(row => {
      let status: AvailabilityStatus = 'AVAILABLE';
      if (row.free_rooms === 0) status = 'FULL';
      else if (row.free_rooms < row.total_rooms * 0.2) status = 'LIMITED';

      return {
        day: row.day,
        status,
        total: row.total_rooms,
        free: row.free_rooms,
        blocked: row.total_rooms - row.free_rooms,
      };
    });
  }
}
