import { Router } from 'express';
import { MarketingController } from './marketing.controller.js';
import { MarketingService } from './marketing.service.js';
import { MarketingRepository } from './marketing.repository.js';
import { ReportsService } from '../reports/reports.service.js';
import { ReportsRepository } from '../reports/reports.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { GenerateCampaignSchema } from './marketing.types.js';

export function createMarketingRouter(dbInstance = db): Router {
  const router = Router();
  const service = new MarketingService(new MarketingRepository(dbInstance));
  const reports = new ReportsService(new ReportsRepository(dbInstance));
  const controller = new MarketingController(service, reports);

  router.use(authenticate);
  // Shares the management/analytics permission with the dashboards (A4/A5).
  router.get('/segments', authorize('reports.read'), controller.segments);
  router.post('/campaign', authorize('reports.read'), validateBody(GenerateCampaignSchema), controller.campaign);
  router.get('/strategy', authorize('reports.read'), controller.strategy);

  return router;
}
