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
import { rateLimit } from 'express-rate-limit';

export function createMarketingRouter(dbInstance = db): Router {
  const router = Router();
  const service = new MarketingService(new MarketingRepository(dbInstance));
  const reports = new ReportsService(new ReportsRepository(dbInstance));
  const controller = new MarketingController(service, reports);

  router.use(authenticate);

  // (Audit 2026-10-11, L-9) Each campaign or strategy request is one paid call to the language
  // model, and only the global per-IP limit stood in front of it — a looping tab or script
  // could run up the bill. Counted per person, not per IP: 20 an hour is far beyond real use.
  const llmLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => `llm:${req.user?.sub ?? 'anonymous'}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'That’s a lot of AI drafts for one hour. Please try again a little later.',
    },
  });
  // Shares the management/analytics permission with the dashboards (A4/A5).
  router.get('/segments', authorize('reports.read'), controller.segments);
  // Guest contact details, so this one is gated on the CRM permission rather than reports.
  router.get('/segments/:key/members', authorize('crm.contacts.read'), controller.segmentMembers);
  router.post('/campaign', authorize('reports.read'), llmLimiter, validateBody(GenerateCampaignSchema), controller.campaign);
  router.get('/strategy', authorize('reports.read'), llmLimiter, controller.strategy);

  return router;
}
