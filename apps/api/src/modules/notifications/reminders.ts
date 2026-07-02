import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { todayInPropertyTZ, propertyToday } from '../../core/time.js';
import type { NotificationsService } from './notifications.service.js';
import { notifications as sharedNotifications } from './notifications.routes.js';

/**
 * Interval reminders — the "in-app + interval reminders via cron" half of the
 * Phase 2 notifications infrastructure. Each generator scans for an actionable
 * state and raises an in-app notification, keyed so a re-run the same day is a
 * no-op (the sweep can run on any cadence without duplicating alerts).
 *
 * Targeting is deliberately broad for now — every member of the affected property
 * (plus admins). Narrowing to the responsible department is a follow-up once the
 * Phase 3 role mapping lands.
 */

export interface ReminderResult {
  checkoutDue: number;
  maintenanceStale: number;
  maintenanceUnassigned: number;
}

export const NO_REMINDERS: ReminderResult = {
  checkoutDue: 0,
  maintenanceStale: 0,
  maintenanceUnassigned: 0,
};

/** A stale work order is HIGH/CRITICAL, still open, and has sat untouched this long. */
const MAINTENANCE_STALE_DAYS = 2;
/** A pending work order is any-priority OPEN with nobody assigned for this long. */
const MAINTENANCE_UNASSIGNED_DAYS = 1;

export async function runReminders(
  db: Kysely<Database>,
  service: NotificationsService = sharedNotifications,
): Promise<ReminderResult> {
  const today = todayInPropertyTZ();

  const [checkoutDue, maintenanceStale, maintenanceUnassigned] = await Promise.all([
    remindCheckoutsDue(db, service, today),
    remindStaleMaintenance(db, service, today),
    remindUnassignedMaintenance(db, service, today),
  ]);

  return { checkoutDue, maintenanceStale, maintenanceUnassigned };
}

/** Guests departing today — a heads-up so reception/housekeeping can plan the turn. */
async function remindCheckoutsDue(
  db: Kysely<Database>,
  service: NotificationsService,
  today: string,
): Promise<number> {
  const rows = await db
    .selectFrom('reservations as r')
    .innerJoin('rooms as rm', 'rm.id', 'r.room_id')
    .innerJoin('buildings as b', 'b.id', 'rm.building_id')
    .innerJoin('contacts as c', 'c.id', 'r.contact_id')
    .select(['r.id as reservation_id', 'rm.name as room_name', 'c.name as guest_name', 'b.property_id'])
    .where('r.check_out_date', '=', propertyToday())
    .where('r.status', 'in', ['CONFIRMED', 'CHECKED_IN'])
    .where('r.deleted_at', 'is', null)
    .execute();

  let inserted = 0;
  for (const row of rows) {
    inserted += await service.notify(
      { propertyId: row.property_id },
      {
        type: 'reminder.checkout_due',
        title: `Checkout due today — ${row.room_name}`,
        body: `${row.guest_name} is scheduled to check out of ${row.room_name} today.`,
        entityType: 'reservations',
        entityId: row.reservation_id,
        link: `/reservations/${row.reservation_id}`,
        dedupKey: `reminder.checkout_due:${row.reservation_id}:${today}`,
      },
    );
  }
  return inserted;
}

/** High-priority repairs still open after a couple of days — nag until resolved.
 *  Targeting (the Phase 2 follow-up, landed with the Phase 3 role mapping): an
 *  assigned order nags the responsible person directly; an ownerless one still
 *  fans out to the whole property. */
async function remindStaleMaintenance(
  db: Kysely<Database>,
  service: NotificationsService,
  today: string,
): Promise<number> {
  const rows = await db
    .selectFrom('maintenance_work_orders as w')
    .innerJoin('rooms as rm', 'rm.id', 'w.room_id')
    .innerJoin('buildings as b', 'b.id', 'rm.building_id')
    .select(['w.id as work_order_id', 'w.title', 'w.priority', 'w.assigned_to', 'rm.name as room_name', 'b.property_id'])
    .where('w.status', 'in', ['OPEN', 'IN_PROGRESS'])
    .where('w.priority', 'in', ['HIGH', 'CRITICAL'])
    .where('w.opened_at', '<', daysAgo(MAINTENANCE_STALE_DAYS))
    .where('w.deleted_at', 'is', null)
    .execute();

  let inserted = 0;
  for (const row of rows) {
    inserted += await service.notify(
      row.assigned_to
        ? { userId: row.assigned_to }
        : { propertyId: row.property_id },
      {
        propertyId: row.property_id,
        type: 'reminder.maintenance_stale',
        title: `${row.priority} repair still open — ${row.room_name}`,
        body: `"${row.title}" has been open for over ${MAINTENANCE_STALE_DAYS} days.`,
        entityType: 'maintenance_work_orders',
        entityId: row.work_order_id,
        link: `/maintenance/${row.work_order_id}`,
        // Date in the key => a fresh nudge once per day until the order is closed.
        dedupKey: `reminder.maintenance_stale:${row.work_order_id}:${today}`,
      },
    );
  }
  return inserted;
}

/** Work orders nobody has picked up — any priority, nagged daily until assigned. */
async function remindUnassignedMaintenance(
  db: Kysely<Database>,
  service: NotificationsService,
  today: string,
): Promise<number> {
  const rows = await db
    .selectFrom('maintenance_work_orders as w')
    .innerJoin('rooms as rm', 'rm.id', 'w.room_id')
    .innerJoin('buildings as b', 'b.id', 'rm.building_id')
    .select(['w.id as work_order_id', 'w.title', 'w.priority', 'rm.name as room_name', 'b.property_id'])
    .where('w.status', '=', 'OPEN')
    .where('w.assigned_to', 'is', null)
    .where('w.opened_at', '<', daysAgo(MAINTENANCE_UNASSIGNED_DAYS))
    .where('w.deleted_at', 'is', null)
    .execute();

  let inserted = 0;
  for (const row of rows) {
    inserted += await service.notify(
      { propertyId: row.property_id },
      {
        type: 'reminder.maintenance_unassigned',
        title: `Repair still unassigned — ${row.room_name}`,
        body: `"${row.title}" (${row.priority}) has been waiting over ${MAINTENANCE_UNASSIGNED_DAYS} day(s) for someone to be assigned.`,
        entityType: 'maintenance_work_orders',
        entityId: row.work_order_id,
        link: `/maintenance/${row.work_order_id}`,
        // Date in the key => a fresh nudge once per day until it's assigned.
        dedupKey: `reminder.maintenance_unassigned:${row.work_order_id}:${today}`,
      },
    );
  }
  return inserted;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The closure the in-process sweep runs. The sweep ticks every minute, but the
 * reminder generators only need to run daily — so it self-gates and returns zeros
 * in between (per process; a restart just re-runs them, which the dedup keys make
 * a no-op). Same pattern as the retention sweeper. `/cron/reminders` remains as
 * the fallback for a serverless host, exactly like `/cron/sweep`.
 */
export function createRemindersSweeper(
  db: Kysely<Database>,
  service: NotificationsService = sharedNotifications,
  intervalMs: number = DAY_MS,
): () => Promise<ReminderResult> {
  let lastRunMs = 0;

  return async () => {
    const nowMs = Date.now();
    if (nowMs - lastRunMs < intervalMs) return NO_REMINDERS;
    lastRunMs = nowMs;
    return runReminders(db, service);
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
