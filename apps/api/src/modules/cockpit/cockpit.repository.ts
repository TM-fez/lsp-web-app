import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import { propertyToday } from '../../core/time.js';
import type { CockpitUnit, CockpitGuestCard } from './cockpit.types.js';

export class CockpitRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // Every active unit with its current guest (if checked in). Scoped to the
  // active property when one is supplied (it always is on the live board route).
  async units(propertyId?: string): Promise<CockpitUnit[]> {
    let query = this.db
      .selectFrom('rooms as r')
      .leftJoin('occupancy as o', (join) =>
        join.onRef('o.room_id', '=', 'r.id').on('o.status', '=', 'CHECKED_IN').on('o.deleted_at', 'is', null)
      )
      .leftJoin('reservations as res', 'res.id', 'o.reservation_id')
      .leftJoin('contacts as c', 'c.id', 'res.contact_id')
      .leftJoin('buildings as b', 'b.id', 'r.building_id')
      .leftJoin('properties as p', 'p.id', 'b.property_id')
      .select([
        'r.id as room_id',
        'r.name as name',
        'r.code as code',
        'r.type as type',
        'r.status as status',
        'r.housekeeping_status as housekeeping_status',
        'r.capacity as capacity',
        'r.floor as floor',
        'b.id as building_id',
        'b.name as building_name',
        'p.id as property_id',
        'p.name as property_name',
        'c.name as guest_name',
        'o.id as occupancy_id',
        'res.id as reservation_id',
        'res.check_out_date as check_out_date',
      ])
      .where('r.deleted_at', 'is', null);
    if (propertyId) query = query.where('b.property_id', '=', propertyId);
    return query.orderBy('r.code', 'asc').execute();
  }

  // Confirmed reservations arriving today, not yet checked in.
  async arrivals(propertyId?: string): Promise<CockpitGuestCard[]> {
    return this.guestCards(propertyId)
      .where('res.status', '=', 'CONFIRMED')
      .where(sql<boolean>`res.check_in_date = ${propertyToday()}`)
      .orderBy('r.code', 'asc')
      .execute();
  }

  // Everyone currently in-house.
  async inHouse(propertyId?: string): Promise<CockpitGuestCard[]> {
    return this.occupancyCards(propertyId).orderBy('r.code', 'asc').execute();
  }

  // In-house guests whose reservation departs today.
  async departures(propertyId?: string): Promise<CockpitGuestCard[]> {
    return this.occupancyCards(propertyId)
      .where(sql<boolean>`res.check_out_date = ${propertyToday()}`)
      .orderBy('r.code', 'asc')
      .execute();
  }

  // Building ids belonging to a property — used to scope the guest-card queries
  // (a room is in the property when its building_id is in this set).
  private buildingIdsInProperty(propertyId: string) {
    return this.db.selectFrom('buildings').select('id').where('property_id', '=', propertyId);
  }

  // Reservation-rooted card (arrivals): no occupancy yet.
  private guestCards(propertyId?: string) {
    let query = this.db
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
        'res.source as source',
      ])
      .where('res.deleted_at', 'is', null);
    if (propertyId) query = query.where('r.building_id', 'in', this.buildingIdsInProperty(propertyId));
    return query;
  }

  // Occupancy-rooted card (in-house / departures).
  private occupancyCards(propertyId?: string) {
    let query = this.db
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
        'res.source as source',
      ])
      .where('o.status', '=', 'CHECKED_IN')
      .where('o.deleted_at', 'is', null);
    if (propertyId) query = query.where('r.building_id', 'in', this.buildingIdsInProperty(propertyId));
    return query;
  }
}
