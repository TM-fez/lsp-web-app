import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import * as dashboardController from './dashboard.controller.js';

const router = Router();

router.use(authenticate);
router.use(authorize('dashboard:read'));

router.get('/stats',    dashboardController.stats);
router.get('/activity', dashboardController.activity);

export { router as dashboardRouter };
