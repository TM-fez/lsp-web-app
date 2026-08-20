import type { Request, Response, NextFunction } from 'express';
import { MarketingService } from './marketing.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { accessiblePropertyIdsForUser } from '../../core/scope/activeProperty.js';
import { AppError } from '../../core/errors/AppError.js';
import { SEGMENT_KEYS, type GenerateCampaignDTO, type SegmentKey } from './marketing.types.js';

export class MarketingController {
  constructor(
    private readonly service: MarketingService,
    private readonly reports: ReportsService,
  ) {}

  // GET /marketing/segments — deterministic guest segmentation (+ LLM-configured flag).
  segments = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getSegments());
    } catch (err) {
      next(err);
    }
  };

  // GET /marketing/segments/:key/members — the guests inside one segment, for calling or
  // exporting. Gated on crm.contacts.read, not reports.read: this hands back guest phone
  // numbers and email addresses, so it is contact data first and analytics second.
  segmentMembers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.params.key as SegmentKey;
      if (!SEGMENT_KEYS.includes(key)) {
        throw AppError.badRequest(
          `There is no “${req.params.key}” guest segment. Choose one of: ${SEGMENT_KEYS.join(', ')}.`
        );
      }
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const limit = parseInt(req.query.limit as string, 10) || undefined;
      res.json(await this.service.getSegmentMembers(key, { search, limit }));
    } catch (err) {
      next(err);
    }
  };

  // POST /marketing/campaign — draft campaign copy for a segment (LLM-gated).
  campaign = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.generateCampaign(req.body as GenerateCampaignDTO));
    } catch (err) {
      next(err);
    }
  };

  // GET /marketing/strategy — a strategy brief from the P&L/occupancy dashboard
  // (LLM-gated). Scoped to the caller's accessible properties, like reports.
  strategy = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accessiblePropertyIds = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
      const reports = await this.reports.getReports({ accessiblePropertyIds });
      res.json(await this.service.getStrategy(reports));
    } catch (err) {
      next(err);
    }
  };
}
