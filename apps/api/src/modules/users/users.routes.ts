import { Router } from 'express';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { UsersRepository } from './users.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateUserSchema, ResetPasswordSchema, UpdateUserSchema } from './users.types.js';

export function createUsersRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new UsersRepository(dbInstance);
  const service = new UsersService(repository);
  const controller = new UsersController(service);

  router.use(authenticate);

  // /roles before /:id so "roles" never matches as a user id.
  router.get('/roles', authorize('users.read'), controller.listRoles);
  router.get('/', authorize('users.read'), controller.listUsers);
  router.get('/:id', authorize('users.read'), controller.getUserById);

  router.post('/', authorize('users.create'), validateBody(CreateUserSchema), controller.createUser);

  router.patch('/:id', authorize('users.update'), validateBody(UpdateUserSchema), controller.updateUser);

  router.post(
    '/:id/reset-password',
    authorize('users.reset_password'),
    validateBody(ResetPasswordSchema),
    controller.resetPassword
  );

  return router;
}
