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

  // Static paths before /:id so they never match as a user id.
  // Directory is intentionally open to any authenticated staff (names + roles only)
  // so pickers like maintenance "assign to" work without users.read (admin-only).
  // DELIBERATE (H5 review): no authorize() gate. Any signed-in staff member may read
  // the directory — it powers assign-to pickers across modules and returns only
  // id / name / role / is_lead (no emails, no permissions, no property memberships).
  router.get('/directory', controller.listDirectory);
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
