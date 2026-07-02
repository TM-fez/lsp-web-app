import type { HousekeepingQueueItem } from '../housekeeping/housekeeping.repository.js';

// A unit tile on the board: operational status + readiness + who's in it.
export interface CockpitUnit {
  room_id: string;
  name: string;
  code: string;
  type: string;
  status: string;               // operational: AVAILABLE | OCCUPIED | MAINTENANCE | OUT_OF_SERVICE
  housekeeping_status: string;  // READY | DIRTY | CLEANING | INSPECTED
  capacity: number;
  floor: number | null;
  building_id: string | null;
  building_name: string | null;
  property_id: string | null;
  property_name: string | null;
  guest_name: string | null;        // current in-house guest, if any
  occupancy_id: string | null;
  reservation_id: string | null;
  check_out_date: Date | null;      // expected departure of the current guest
}

// A guest card in the Today rail (arrivals / in-house / departures).
export interface CockpitGuestCard {
  reservation_id: string;
  occupancy_id: string | null;
  contact_id: string;
  guest_name: string;
  room_id: string;
  room_name: string;
  room_code: string;
  check_in_date: Date;
  check_out_date: Date;
  status: string;
  // Booking origin (DIRECT/WEBSITE/BOOKING_COM/…) — front desk sees at a glance
  // whether an arrival is an OTA guest (H6 source badges).
  source: string;
}

export interface CockpitBoard {
  date: string;
  units: CockpitUnit[];
  arrivals: CockpitGuestCard[];
  in_house: CockpitGuestCard[];
  departures: CockpitGuestCard[];
  housekeeping_queue: HousekeepingQueueItem[];
}
