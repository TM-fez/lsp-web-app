import { PricingRepository } from './pricing.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { RatePlanRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type {
  CreateRatePlanDTO,
  UpdateRatePlanDTO,
  RatePlanFilters,
  PricingRequestMeta,
  PriceResult,
  PriceSegment,
  UnitType,
} from './pricing.types.js';

const NIGHTS_PER_WEEK = 7;
const NIGHTS_PER_MONTH = 30;

export class PricingService {
  constructor(private readonly repository: PricingRepository) {}

  async listRatePlans(
    filters: RatePlanFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<RatePlanRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async getRatePlan(id: string): Promise<RatePlanRow> {
    const plan = await this.repository.findById(id);
    if (!plan) throw AppError.notFound(`Rate plan ${id} not found`);
    return plan;
  }

  async getActivePlan(unitType: UnitType): Promise<RatePlanRow> {
    const plan = await this.repository.findActiveByUnitType(unitType);
    if (!plan) throw AppError.notFound(`No active rate plan for unit type ${unitType}`);
    return plan;
  }

  async createRatePlan(dto: CreateRatePlanDTO, meta: PricingRequestMeta): Promise<RatePlanRow> {
    return this.repository.create({ ...dto, created_by: meta.userId, updated_by: meta.userId }, meta);
  }

  async updateRatePlan(id: string, dto: UpdateRatePlanDTO, meta: PricingRequestMeta): Promise<RatePlanRow> {
    await this.getRatePlan(id);
    const updated = await this.repository.update(id, { ...dto, updated_by: meta.userId }, meta);
    if (!updated) throw AppError.notFound(`Failed to update rate plan ${id}`);
    return updated;
  }

  async deleteRatePlan(id: string, meta: PricingRequestMeta): Promise<void> {
    await this.getRatePlan(id);
    const ok = await this.repository.softDelete(id, meta);
    if (!ok) throw AppError.notFound(`Failed to delete rate plan ${id}`);
  }

  /**
   * Decompose a stay of `nights` into the cheapest mix of month/week/night
   * blocks for the plan. Uses dynamic programming with overshoot, so a guest is
   * automatically given a cheaper longer block when it beats buying the exact
   * number of nights (team-explainable via the returned segments).
   */
  priceStay(plan: RatePlanRow, nights: number): PriceResult {
    if (nights < 1) throw AppError.badRequest('Stay must be at least one night');

    const blocks = [
      { unit: 'month' as const, size: NIGHTS_PER_MONTH, rate: plan.monthly_rate },
      { unit: 'week' as const, size: NIGHTS_PER_WEEK, rate: plan.weekly_rate },
      { unit: 'night' as const, size: 1, rate: plan.nightly_rate },
    ].filter((b) => b.rate > 0);

    type Block = (typeof blocks)[number];
    const cost = new Array<number>(nights + 1).fill(Number.POSITIVE_INFINITY);
    const choice = new Array<Block | null>(nights + 1).fill(null);
    cost[0] = 0;

    for (let n = 1; n <= nights; n++) {
      for (const b of blocks) {
        const prev = Math.max(0, n - b.size);
        const candidate = cost[prev]! + b.rate;
        if (candidate < cost[n]!) {
          cost[n] = candidate;
          choice[n] = b;
        }
      }
    }

    // Reconstruct which blocks were used.
    const counts = new Map<string, { unit: Block['unit']; rate: number; count: number }>();
    let n = nights;
    while (n > 0) {
      const b = choice[n]!;
      const entry = counts.get(b.unit) ?? { unit: b.unit, rate: b.rate, count: 0 };
      entry.count += 1;
      counts.set(b.unit, entry);
      n = Math.max(0, n - b.size);
    }

    const order: Array<Block['unit']> = ['month', 'week', 'night'];
    const segments: PriceSegment[] = order
      .filter((u) => counts.has(u))
      .map((u) => {
        const e = counts.get(u)!;
        return { unit: e.unit, count: e.count, unit_rate: e.rate, amount: e.count * e.rate };
      });

    return { base_amount: cost[nights]!, currency: plan.currency, segments };
  }

  // Team-informed price preview for a unit type + length of stay (no quote created).
  async previewPrice(unitType: UnitType, nights: number) {
    const plan = await this.getActivePlan(unitType);
    const price = this.priceStay(plan, nights);
    return {
      rate_plan_id: plan.id,
      unit_type: unitType,
      nights,
      currency: price.currency,
      base_amount: price.base_amount,
      segments: price.segments,
      tax_rate_bps: plan.tax_rate_bps,
      deposit_pct: plan.deposit_pct,
    };
  }
}
