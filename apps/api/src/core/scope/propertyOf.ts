import type { Request, Response, NextFunction } from 'express';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../db/types.js';
import { AppError } from '../errors/AppError.js';

/**
 * Which property a commercial entity belongs to, resolved through its FK chain to
 * a room → building → property. Every resolver is one query. `null` means the
 * chain ends nowhere (room without a building, hold without a room yet, …) — the
 * same semantics the rooms module uses: not in ANY property, so a property-scoped
 * request can never reach it.
 *
 * These power H5's scoping rollout: quotes are deliberately ABSENT (a quote is by
 * unit type + rate plan and references no room, so it has no property to scope to).
 */

type Db = Kysely<Database>;

async function one(db: Db, query: ReturnType<typeof sql<{ property_id: string | null }>>): Promise<string | null> {
  const res = await query.execute(db);
  return res.rows[0]?.property_id ?? null;
}

export function propertyOfRoom(db: Db, roomId: string): Promise<string | null> {
  return one(
    db,
    sql<{ property_id: string | null }>`
      SELECT b.property_id FROM rooms r
      LEFT JOIN buildings b ON b.id = r.building_id
      WHERE r.id = ${roomId} AND r.deleted_at IS NULL
    `,
  );
}

export function propertyOfReservation(db: Db, reservationId: string): Promise<string | null> {
  return one(
    db,
    sql<{ property_id: string | null }>`
      SELECT b.property_id FROM reservations res
      JOIN rooms r ON r.id = res.room_id
      LEFT JOIN buildings b ON b.id = r.building_id
      WHERE res.id = ${reservationId}
    `,
  );
}

/** Via the hold's room, or its reservation's room when no room was pinned. */
export function propertyOfHold(db: Db, holdId: string): Promise<string | null> {
  return one(
    db,
    sql<{ property_id: string | null }>`
      SELECT b.property_id FROM holds h
      LEFT JOIN reservations res ON res.id = h.reservation_id
      LEFT JOIN rooms r ON r.id = coalesce(h.room_id, res.room_id)
      LEFT JOIN buildings b ON b.id = r.building_id
      WHERE h.id = ${holdId} AND h.deleted_at IS NULL
    `,
  );
}

export function propertyOfPaymentIntent(db: Db, intentId: string): Promise<string | null> {
  return one(
    db,
    sql<{ property_id: string | null }>`
      SELECT b.property_id FROM payment_intents pi
      JOIN holds h ON h.id = pi.hold_id
      LEFT JOIN reservations res ON res.id = h.reservation_id
      LEFT JOIN rooms r ON r.id = coalesce(h.room_id, res.room_id)
      LEFT JOIN buildings b ON b.id = r.building_id
      WHERE pi.id = ${intentId}
    `,
  );
}

/** Via the invoice's reservation, falling back to its hold. */
export function propertyOfInvoice(db: Db, invoiceId: string): Promise<string | null> {
  return one(
    db,
    sql<{ property_id: string | null }>`
      SELECT b.property_id FROM invoices i
      LEFT JOIN reservations ires ON ires.id = i.reservation_id
      LEFT JOIN holds h ON h.id = i.hold_id
      LEFT JOIN reservations hres ON hres.id = h.reservation_id
      LEFT JOIN rooms r ON r.id = coalesce(ires.room_id, h.room_id, hres.room_id)
      LEFT JOIN buildings b ON b.id = r.building_id
      WHERE i.id = ${invoiceId} AND i.deleted_at IS NULL
    `,
  );
}

export function propertyOfOccupancy(db: Db, occupancyId: string): Promise<string | null> {
  return one(
    db,
    sql<{ property_id: string | null }>`
      SELECT b.property_id FROM occupancy o
      JOIN rooms r ON r.id = o.room_id
      LEFT JOIN buildings b ON b.id = r.building_id
      WHERE o.id = ${occupancyId}
    `,
  );
}

type Resolver = (db: Db, id: string) => Promise<string | null>;

/**
 * By-id route guard: the entity in `req.params.id` must resolve to the caller's
 * active property, else "not found" (never "forbidden" — existence outside your
 * property is not yours to learn). Mount AFTER authorize + requireActiveProperty.
 *
 * A null chain is refused here on purpose for most money entities (H5): a hold
 * without a room is not yet in any property, so a scoped request must not reach
 * it. Invoices are the exception — see `requireInActivePropertyAllowUnattributed`.
 */
export function requireInActiveProperty(db: Db, resolve: Resolver, entityLabel: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const pid = await resolve(db, req.params.id as string);
      if (!pid || pid !== req.activePropertyId) {
        return next(AppError.notFound(`${entityLabel} not found`));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Invoice by-id guard: same as `requireInActiveProperty`, except a null property
 * chain is allowed (house-wide / "Unattributed").
 *
 * Why the exception (list + settle parity): Finance Cockpit LEFT JOINs the
 * property chain and surfaces open invoices with no room as Unattributed debt.
 * The Invoices list used to hide those rows, and the strict H5 by-id guard then
 * 404'd settle/refund even if you had the UUID — BWP of collectable debt that
 * Accounts could see on the cockpit and nowhere else. Matching D03's coalesce
 * rule here means: attributed invoices stay property-scoped; unattributed ones
 * are visible and collectable from any active property, without leaking another
 * property's attributed invoices.
 */
export function requireInActivePropertyAllowUnattributed(
  db: Db,
  resolve: Resolver,
  entityLabel: string
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const pid = await resolve(db, req.params.id as string);
      if (pid !== null && pid !== req.activePropertyId) {
        return next(AppError.notFound(`${entityLabel} not found`));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Create-route guard for a reference carried in the BODY (e.g. payments create
 * references hold_id): the referenced entity must sit in the active property.
 * Skips silently when the field is absent — schema validation owns "required".
 */
export function requireBodyRefInActiveProperty(db: Db, field: string, resolve: Resolver, entityLabel: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const id = (req.body as Record<string, unknown> | undefined)?.[field];
      if (typeof id !== 'string' || id.length === 0) return next();
      const pid = await resolve(db, id);
      if (!pid || pid !== req.activePropertyId) {
        return next(AppError.notFound(`${entityLabel} not found`));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
