// Domain types mirroring the LSP API responses (JSON — dates arrive as strings).

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  role: string;
  permissions: string[];
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export type RoomStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
export type HousekeepingStatus = 'READY' | 'DIRTY' | 'CLEANING' | 'INSPECTED';
export type HousekeepingTaskStatus = 'OPEN' | 'CLEANING' | 'INSPECTED' | 'DONE';
export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
export type UnitType = 'STANDARD' | 'DELUXE' | 'SUITE' | 'CONFERENCE' | 'CUSTOM';
export type PaymentMethod = 'CARD' | 'MOBILE_MONEY' | 'EFT' | 'CASH' | 'CORPORATE_CREDIT';

// ── Cockpit board ─────────────────────────────────────────────────────────────

export interface CockpitUnit {
  room_id: string;
  name: string;
  code: string;
  type: UnitType;
  status: RoomStatus;
  housekeeping_status: HousekeepingStatus;
  capacity: number;
  guest_name: string | null;
  occupancy_id: string | null;
  reservation_id: string | null;
  check_out_date: string | null;
}

export interface CockpitGuestCard {
  reservation_id: string;
  occupancy_id: string | null;
  contact_id: string;
  guest_name: string;
  room_id: string;
  room_name: string;
  room_code: string;
  check_in_date: string;
  check_out_date: string;
  status: ReservationStatus;
}

export interface HousekeepingQueueItem {
  task_id: string;
  room_id: string;
  room_name: string;
  room_code: string;
  task_status: HousekeepingTaskStatus;
  housekeeping_status: HousekeepingStatus;
  assigned_to: string | null;
  occupancy_id: string | null;
  opened_at: string;
  started_at: string | null;
  inspected_at: string | null;
}

export interface CockpitBoard {
  date: string;
  units: CockpitUnit[];
  arrivals: CockpitGuestCard[];
  in_house: CockpitGuestCard[];
  departures: CockpitGuestCard[];
  housekeeping_queue: HousekeepingQueueItem[];
}

// ── Commercial flow entities ──────────────────────────────────────────────────

export type ContactType = 'individual' | 'company';

export interface Contact {
  id: string;
  type: ContactType;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  name: string;
  code: string;
  type: UnitType;
  status: RoomStatus;
  housekeeping_status: HousekeepingStatus;
  capacity: number;
  notes?: string | null;
}

export type RoomCreateStatus = 'AVAILABLE' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

export interface RatePlan {
  id: string;
  unit_type: UnitType;
  name: string;
  nightly_rate: number; // thebe
  weekly_rate: number; // thebe
  monthly_rate: number; // thebe
  min_nights: number;
  max_guests: number;
  deposit_pct: number; // 0–100
  tax_rate_bps: number; // basis points (1400 = 14%)
  currency: string;
  active: boolean;
}

export interface Reservation {
  id: string;
  contact_id: string;
  room_id: string;
  check_in_date: string;
  check_out_date: string;
  status: ReservationStatus;
}

export interface Quote {
  id: string;
  unit_type: UnitType;
  nights: number;
  currency: string;
  total_amount: number;
  deposit_amount: number;
  tax_amount: number;
  status: 'ACTIVE' | 'EXPIRED' | 'CONSUMED';
}

export interface Hold {
  id: string;
  quote_id: string;
  reservation_id: string | null;
  room_id: string | null;
  status: 'HELD' | 'CONFIRMED' | 'EXPIRED' | 'RELEASED';
  held_until: string;
}

export interface PaymentIntent {
  id: string;
  hold_id: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: 'PENDING' | 'RETRY' | 'PAID' | 'FAILED' | 'EXPIRED';
  attempts: number;
  max_attempts: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
