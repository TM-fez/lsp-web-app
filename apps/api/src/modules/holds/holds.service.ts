import { HoldsRepository } from './holds.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { AppError } from '../../core/errors/AppError.js';
import type { HoldRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { CreateHoldDTO, HoldFilters, HoldRequestMeta } from './holds.types.js';

const HOLD_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RETRY_EXTENSION_MS = 15 * 60 * 1000; // each retry buys 15 more minutes

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export class HoldsService {
  constructor(
    private readonly repository: HoldsRepository,
    private readonly quotes: QuotesService
  ) {}

  async getHold(id: string): Promise<HoldRow> {
    const hold = await this.repository.findById(id);
    if (!hold) throw AppError.notFound(`Hold ${id} not found`);
    return hold;
  }

  async listHolds(filters: HoldFilters, pagination: PaginationOptions): Promise<PaginatedResult<HoldRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async createHold(dto: CreateHoldDTO, meta: HoldRequestMeta): Promise<HoldRow> {
    const quote = await this.quotes.getQuote(dto.quote_id);
    this.quotes.assertUsable(quote);

    try {
      return await this.repository.create(
        {
          quoteId: dto.quote_id,
          roomId: dto.room_id ?? null,
          reservationId: dto.reservation_id ?? null,
          heldUntil: new Date(Date.now() + HOLD_TTL_MS),
        },
        meta
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('A live hold already exists for this quote');
      throw err;
    }
  }

  async confirm(id: string, meta: HoldRequestMeta): Promise<HoldRow> {
    const hold = await this.getHold(id);
    if (hold.status !== 'HELD') {
      throw AppError.conflict(`Only a HELD reservation can be confirmed (current: ${hold.status})`);
    }
    const updated = await this.repository.markStatus(id, 'CONFIRMED', null, meta);
    if (!updated) throw AppError.notFound(`Failed to confirm hold ${id}`);
    return updated;
  }

  async release(id: string, reason: string, meta: HoldRequestMeta): Promise<HoldRow> {
    const hold = await this.getHold(id);
    if (hold.status !== 'HELD') {
      throw AppError.conflict(`Only a HELD reservation can be released (current: ${hold.status})`);
    }
    const updated = await this.repository.markStatus(id, 'RELEASED', reason, meta);
    if (!updated) throw AppError.notFound(`Failed to release hold ${id}`);
    return updated;
  }

  /** Retry-before-release: keep the hold and extend its window. */
  async recordRetry(id: string, meta: HoldRequestMeta): Promise<HoldRow> {
    const hold = await this.getHold(id);
    if (hold.status !== 'HELD') {
      throw AppError.conflict(`Only a HELD reservation can be retried (current: ${hold.status})`);
    }
    const updated = await this.repository.incrementRetry(id, new Date(Date.now() + RETRY_EXTENSION_MS), meta);
    if (!updated) throw AppError.notFound(`Failed to record retry on hold ${id}`);
    return updated;
  }

  /** Auto/smart release sweep — returns the number of holds expired. */
  async releaseExpired(): Promise<number> {
    return this.repository.releaseExpired();
  }
}
