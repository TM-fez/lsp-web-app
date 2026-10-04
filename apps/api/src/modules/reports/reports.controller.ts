import type { Request, Response, NextFunction } from 'express';
import { ReportsService } from './reports.service.js';
import { accessiblePropertyIdsForUser } from '../../core/scope/activeProperty.js';
import { propertyScopeForUser } from '../../core/scope/propertyScope.js';
import type { RevenueBasis } from './reports.types.js';

/** Shown to anyone who cannot see every property — see ReportsResponse.scope_note. */
export const COMPANY_COSTS_EXCLUDED_NOTE =
  'Company-level costs (operating costs that belong to no single property, such as the payroll total) are not included, because your access covers only some properties.';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which revenue clock the caller asked for. Anything unrecognised falls back to the
 * default rather than 400-ing: a typo in a query string should not blank the P&L, and
 * the response says which basis it actually used either way.
 */
function basisOf(req: Request): RevenueBasis | undefined {
  return String(req.query.basis ?? '').toLowerCase() === 'cash' ? 'CASH' : undefined;
}

export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  // GET /reports/nudges — rule-based occupancy nudges for the caller's properties.
  nudges = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accessiblePropertyIds = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
      res.json({ data: await this.service.getNudges(accessiblePropertyIds) });
    } catch (err) {
      next(err);
    }
  };

  // GET /reports/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD&property_id=…&basis=accrual|cash
  pnl = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const from = typeof req.query.from === 'string' && DATE.test(req.query.from) ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' && DATE.test(req.query.to) ? req.query.to : undefined;
      const propertyId = (req.query.property_id as string) || undefined;
      // Access scope: admins and anyone who can see EVERY property get no restriction
      // (which is what includes company-level costs that belong to no property); everyone
      // else sees only their own properties and the response says plainly that company-level
      // costs are left out. A picked property_id outside that set simply yields no rows.
      // (Round 4, H10: a both-property accountant used to differ from admin by exactly the
      // company-level costs, with no explanation.)
      const scope = await propertyScopeForUser(req.user!.sub, req.user!.role);
      const accessiblePropertyIds = scope.allProperties ? null : scope.ids;
      const report = await this.service.getReports({ from, to, propertyId, accessiblePropertyIds, basis: basisOf(req) });
      res.json({ ...report, scope_note: scope.allProperties ? null : COMPANY_COSTS_EXCLUDED_NOTE });
    } catch (err) {
      next(err);
    }
  };

  // GET /reports/revenue?from=…&to=…&property_id=… — earned vs received, by month.
  revenue = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const from = typeof req.query.from === 'string' && DATE.test(req.query.from) ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' && DATE.test(req.query.to) ? req.query.to : undefined;
      const propertyId = (req.query.property_id as string) || undefined;
      const accessiblePropertyIds = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
      res.json(await this.service.getRevenue({ from, to, propertyId, accessiblePropertyIds }));
    } catch (err) {
      next(err);
    }
  };

  // GET /reports/operations?months=12&property_id=… — occupancy trend + YoY comparison.
  operations = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const months = typeof req.query.months === 'string' ? Number(req.query.months) : undefined;
      const propertyId = (req.query.property_id as string) || undefined;
      const accessiblePropertyIds = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
      res.json(await this.service.getOperations({
        months: Number.isFinite(months) ? months : undefined,
        propertyId,
        accessiblePropertyIds,
      }));
    } catch (err) {
      next(err);
    }
  };

  // GET /reports/owners?from=YYYY-MM-DD&to=YYYY-MM-DD&property_id=… — per-landlord
  // payout statements for units LSP manages on behalf of third-party owners.
  owners = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const from = typeof req.query.from === 'string' && DATE.test(req.query.from) ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' && DATE.test(req.query.to) ? req.query.to : undefined;
      const propertyId = (req.query.property_id as string) || undefined;
      const accessiblePropertyIds = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
      res.json(await this.service.getOwnerStatements({ from, to, propertyId, accessiblePropertyIds }));
    } catch (err) {
      next(err);
    }
  };
}
