import { Router } from 'express';
import { liveness, readiness, storageHealth } from './health.controller.js';

const router = Router();

router.get('/',        liveness);
router.get('/ready',   readiness);
router.get('/storage', storageHealth);

export { router as healthRouter };
