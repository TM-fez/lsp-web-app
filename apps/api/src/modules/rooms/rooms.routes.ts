import { Router } from 'express';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';
import { RoomsRepository } from './rooms.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateRoomSchema, UpdateRoomSchema } from './rooms.types.js';

export function createRoomsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new RoomsRepository(dbInstance);
  const service = new RoomsService(repository);
  const controller = new RoomsController(service);

  router.use(authenticate);

  router.get('/available', authorize('rooms.read'), controller.listAvailable);
  router.get('/', authorize('rooms.read'), controller.getRooms);
  router.get('/:id', authorize('rooms.read'), controller.getRoomById);

  router.post('/', authorize('rooms.create'), validateBody(CreateRoomSchema), controller.createRoom);

  router.patch('/:id', authorize('rooms.update'), validateBody(UpdateRoomSchema), controller.updateRoom);

  // Status transitions (rules enforced in the service layer)
  router.post('/:id/maintenance',    authorize('rooms.update'), controller.setMaintenance);
  router.post('/:id/out-of-service', authorize('rooms.update'), controller.setOutOfService);
  router.post('/:id/restore',        authorize('rooms.update'), controller.restoreRoom);

  router.delete('/:id', authorize('rooms.delete'), controller.deleteRoom);

  return router;
}
