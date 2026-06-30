import type { Request, Response, NextFunction } from 'express';
import { db } from '../../config/db.js';
import { AppError } from '../errors/AppError.js';
import type { PropertyRow } from '../../db/types.js';

// The header the web app sends to declare which property the user is working in.
export const ACTIVE_PROPERTY_HEADER = 'x-property-id';

// Augment Express so handlers can read the validated active property.
declare global {
  namespace Express {
    interface Request {
      activePropertyId?: string;
    }
  }
}

/** Admin is a wildcard — access to every property, no membership rows needed. */
function isAdmin(role: string | undefined): boolean {
  return role === 'admin';
}

/**
 * The properties a user may enter. Admin sees every active property; everyone
 * else sees exactly the properties they have a `user_properties` row for. Used to
 * drive the post-login picker (`/auth/me`).
 */
export async function accessiblePropertiesForUser(
  userId: string,
  role: string | undefined,
): Promise<PropertyRow[]> {
  if (isAdmin(role)) {
    return db
      .selectFrom('properties')
      .selectAll()
      .where('active', '=', true)
      .orderBy('name', 'asc')
      .execute();
  }
  return db
    .selectFrom('properties')
    .innerJoin('user_properties', 'user_properties.property_id', 'properties.id')
    .selectAll('properties')
    .where('user_properties.user_id', '=', userId)
    .where('properties.active', '=', true)
    .orderBy('properties.name', 'asc')
    .execute();
}

/**
 * The property ids a user may see, for management views (reports, expenses) that
 * span properties rather than working in one active property. Returns `null` for
 * admin (a wildcard — no restriction), otherwise the user's membership ids (an
 * empty array means "no properties", i.e. see nothing).
 */
export async function accessiblePropertyIdsForUser(
  userId: string,
  role: string | undefined,
): Promise<string[] | null> {
  if (isAdmin(role)) return null;
  const rows = await db
    .selectFrom('user_properties')
    .select('property_id')
    .where('user_id', '=', userId)
    .execute();
  return rows.map((r) => r.property_id);
}

/** Whether a user may act within a given property (admin always may). */
export async function userCanAccessProperty(
  userId: string,
  role: string | undefined,
  propertyId: string,
): Promise<boolean> {
  if (isAdmin(role)) {
    const prop = await db
      .selectFrom('properties')
      .select('id')
      .where('id', '=', propertyId)
      .where('active', '=', true)
      .executeTakeFirst();
    return !!prop;
  }
  const row = await db
    .selectFrom('user_properties')
    .select('property_id')
    .where('user_id', '=', userId)
    .where('property_id', '=', propertyId)
    .executeTakeFirst();
  return !!row;
}

/**
 * Gate for property-scoped routes: requires a valid X-Property-Id the user is a
 * member of, and attaches it as `req.activePropertyId`. This is the single
 * enforcement point — scoped queries filter by `req.activePropertyId`, so a user
 * can never reach another property's data even by forging the header.
 */
export async function requireActiveProperty(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    const headerValue = req.headers[ACTIVE_PROPERTY_HEADER];
    const propertyId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!propertyId) {
      return next(AppError.badRequest('No active property selected'));
    }

    const allowed = await userCanAccessProperty(user.sub, user.role, propertyId);
    if (!allowed) {
      return next(AppError.forbidden('You do not have access to this property'));
    }

    req.activePropertyId = propertyId;
    next();
  } catch (err) {
    next(err);
  }
}
