import { Router } from 'express';
import { ChannelController } from './channel.controller.js';
import { ChannelService } from './channel.service.js';
import { ChannelRepository } from './channel.repository.js';
import { db } from '../../config/db.js';

/**
 * PUBLIC, NO-AUTH iCal export feeds — one per unit. The secrecy is the unguessable
 * per-unit token in the URL, not a login: Booking.com (and any subscriber) fetches this
 * server-side. The feed is intentionally minimal — busy nights only, no guest PII.
 *
 * URL handed to the OTA extranet:
 *   {API_BASE}/api/v1/ical/units/{rooms.ical_token}.ics
 */
export function createChannelRouter(dbInstance = db): Router {
  const router = Router();

  const service = new ChannelService(new ChannelRepository(dbInstance));
  const controller = new ChannelController(service);

  router.get('/units/:token', controller.exportUnitFeed);

  return router;
}
