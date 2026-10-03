import { Router } from 'express';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';
import { SettingsController } from './settings.controller.js';
import { UpdateSettingsSchema } from './settings.types.js';

/**
 * (P7) Admin → Settings: business details printed on invoices, payment terms and the
 * website-booking hold. Admin-only (settings.read / settings.update, migration 074).
 * "My account" (change your own password) lives under /auth, open to every signed-in user.
 */
export function createSettingsRouter(dbInstance = db): Router {
  const router = Router();
  const controller = new SettingsController(new SettingsService(new SettingsRepository(dbInstance)));
  router.use(authenticate);
  router.get('/', authorize('settings.read'), controller.get);
  router.patch('/', authorize('settings.update'), validateBody(UpdateSettingsSchema), controller.update);
  return router;
}
