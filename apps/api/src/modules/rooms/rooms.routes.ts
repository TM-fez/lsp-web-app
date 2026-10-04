import { Router } from 'express';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';
import { RoomsRepository } from './rooms.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';
import { propertyOfBuilding, requireBodyRefInActiveProperty } from '../../core/scope/propertyOf.js';
import { AppError } from '../../core/errors/AppError.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateRoomSchema, UpdateRoomSchema, UpdateChannelConfigSchema } from './rooms.types.js';
import type { Request, Response, NextFunction } from 'express';

export function createRoomsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new RoomsRepository(dbInstance);
  const service = new RoomsService(repository);
  const controller = new RoomsController(service);

  // By-id scope guard: a unit outside the active property is "not found".
  const inActiveProperty = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const pid = await repository.roomPropertyId(req.params.id as string);
      if (pid !== req.activePropertyId) return next(AppError.notFound('Room not found'));
      next();
    } catch (err) {
      next(err);
    }
  };

  router.use(authenticate);

  // Unit lists are scoped to the active property (drives the reservation form,
  // the cockpit assign drawer, and the Units page).
  router.get('/available', authorize('rooms.read'), requireActiveProperty, controller.listAvailable);
  router.get('/', authorize('rooms.read'), requireActiveProperty, controller.getRooms);

  // (Re-test 2026-10-04) A unit is placed in a building, and the building decides its
  // property. Create took any building_id, so a CBD-only manager could add a unit to a
  // Village block. The building must now sit in the active property — on create, and on
  // an edit that moves a unit (by-id routes below already check the unit's CURRENT home).
  const buildingInActiveProperty = requireBodyRefInActiveProperty(dbInstance, 'building_id', propertyOfBuilding, 'Building');

  router.post('/', authorize('rooms.create'), requireActiveProperty, validateBody(CreateRoomSchema), buildingInActiveProperty, controller.createRoom);

  // Every by-id route is scoped to the active property.
  router.get('/:id', authorize('rooms.read'), requireActiveProperty, inActiveProperty, controller.getRoomById);
  router.patch('/:id', authorize('rooms.update'), requireActiveProperty, inActiveProperty, validateBody(UpdateRoomSchema), buildingInActiveProperty, controller.updateRoom);
  // Channel sync (H4): per-unit Booking.com import URL + export-token rotation.
  router.patch('/:id/channel', authorize('rooms.channel.manage'), requireActiveProperty, inActiveProperty, validateBody(UpdateChannelConfigSchema), controller.setChannelConfig);
  router.post('/:id/channel/rotate-token', authorize('rooms.channel.manage'), requireActiveProperty, inActiveProperty, controller.rotateIcalToken);
  // Guest self check-in (Phase 5): rotate the in-apartment QR token (reprint after).
  router.post('/:id/guest-qr/rotate-token', authorize('rooms.channel.manage'), requireActiveProperty, inActiveProperty, controller.rotateGuestToken);

  router.post('/:id/maintenance',    authorize('rooms.update'), requireActiveProperty, inActiveProperty, controller.setMaintenance);
  router.post('/:id/out-of-service', authorize('rooms.update'), requireActiveProperty, inActiveProperty, controller.setOutOfService);
  router.post('/:id/restore',        authorize('rooms.update'), requireActiveProperty, inActiveProperty, controller.restoreRoom);
  router.delete('/:id', authorize('rooms.delete'), requireActiveProperty, inActiveProperty, controller.deleteRoom);

  return router;
}
