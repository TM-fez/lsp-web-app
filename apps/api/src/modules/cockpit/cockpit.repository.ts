import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import type { CockpitUnit, CockpitGuestCard } from './cockpit.types.js';

export class CockpitRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // Every active unit with its current guest (if checked in).
  async units(): Promise<CockpitUnit[]> {
    return this.db
      .selectFrom('rooms as r')
      .leftJoin('occupancy as o', (join) =>
        join.onRef('o.room_id', '=', 'r.id').on('o.status', '=', 'CHECKED_IN').on('o.deleted_at', 'is', null)
      )
      .leftJoin('reservations as res', 'res.id', 'o.reservation_id')
      .leftJoin('contacts as c', 'c.id', 'res.contact_id')
      .select([
        'r.id as room_id',
        'r.name as name',
        'r.code as code',
        'r.type as type',
        'r.status as status',
        'r.housekeeping_status as housekeeping_status',
        'r.capacity as capacity',
        'c.name as guest_name',
        'o.id as occupancy_id',
        'res.id as reservation_id',
        'res.check_out_date as check_out_date',
      ])
      .where('r.deleted_at', 'is', null)
      .orderBy('r.code', 'asc')
      .execute();
  }

  // Confirmed reservations arriving today, not yet checked in.
  async arrivals(): Promise<CockpitGuestCard[]> {
    return this.guestCards()
      .where('res.status', '=', 'CONFIRMED')
      .where(sql<boolean>`res.check_in_date = current_date`)
      .orderBy('r.code', 'asc')
      .execute();
  }

  // Everyone currently in-house.
  async inHouse(): Promise<CockpitGuestCard[]> {
    return this.occupancyCards().orderBy('r.code', 'asc').execute();
  }

  // In-house guests whose reservation departs today.
  async departures(): Promise<CockpitGuestCard[]> {
    return this.occupancyCards()
      .where(sql<boolean>`res.check_out_date = current_date`)
      .orderBy('r.code', 'asc')
      .execute();
  }

  // Reservation-rooted card (arrivals): no occupancy yet.
  private guestCards() {
    return this.db
      .selectFrom('reservations as res')
      .innerJoin('contacts as c', 'c.id', 'res.contact_id')
      .innerJoin('rooms as r', 'r.id', 'res.room_id')
      .select([
        'res.id as reservation_id',
        sql<string | null>`null`.as('occupancy_id'),
        'res.contact_id as contact_id',
        'c.name as guest_name',
        'res.room_id as room_id',
        'r.name as room_name',
        'r.code as room_code',
        'res.check_in_date as check_in_date',
        'res.check_out_date as check_out_date',
        'res.status as status',
      ])
      .where('res.deleted_at', 'is', null);
  }

  // Occupancy-rooted card (in-house / departures).
  private occupancyCards() {
    return this.db
      .selectFrom('occupancy as o')
      .innerJoin('reservations as res', 'res.id', 'o.reservation_id')
      .innerJoin('contacts as c', 'c.id', 'res.contact_id')
      .innerJoin('rooms as r', 'r.id', 'o.room_id')
      .select([
        'res.id as reservation_id',
        'o.id as occupancy_id',
        'res.contact_id as contact_id',
        'c.name as guest_name',
        'o.room_id as room_id',
        'r.name as room_name',
        'r.code as room_code',
        'res.check_in_date as check_in_date',
        'res.check_out_date as check_out_date',
        'res.status as status',
      ])
      .where('o.status', '=', 'CHECKED_IN')
      .where('o.deleted_at', 'is', null);
  }
}
