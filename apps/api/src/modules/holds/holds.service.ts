import { HoldsRepository } from './holds.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { holdConflictMessage, isHoldConflict } from './holds.conflicts.js';
import type { HoldRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { CreateHoldDTO, HoldFilters, HoldRequestMeta } from './holds.types.js';
import type { QuoteScope } from '../quotes/quotes.types.js';
import { nightsBetween } from '../quotes/quotes.util.js';

export const HOLD_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RETRY_EXTENSION_MS = 15 * 60 * 1000; // each retry buys 15 more minutes

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

  async createHold(dto: CreateHoldDTO, meta: HoldRequestMeta, scope?: QuoteScope): Promise<HoldRow> {
    // (Audit L-10) Only a quote the caller may see — made by them, held in their property, or
    // they see every property. Attaching any quote id made it "held in mine", so visible, and
    // let a quote someone else priced (an override, say) be paid at the desk.
    const quote = await this.quotes.getQuote(dto.quote_id, scope);
    this.quotes.assertUsable(quote);

    // (Audit 2026-10-11, H-3) A hold on a booking is how that booking gets paid, and the first
    // payment freezes the booking's agreed total from the quote (settlePaid). So the quote must
    // price THIS booking's stay — the same number of nights of the same kind of unit (the rate
    // card has no seasons, so that is what decides the price). Without this check, someone who
    // can quote and take payments (reception) could attach a one-night quote to a month's
    // booking and agree the month at a one-night price: a discount nobody approved.
    if (dto.reservation_id) {
      const stay = await this.repository.reservationStay(dto.reservation_id);
      if (!stay) throw AppError.notFound('Reservation not found');
      const matches =
        nightsBetween(new Date(stay.check_in_date), new Date(stay.check_out_date)) === quote.nights &&
        stay.unit_type === quote.unit_type &&
        (!dto.room_id || dto.room_id === stay.room_id);
      if (!matches) {
        throw AppError.conflict(
          'That quote is for a different length of stay or a different kind of unit than this booking. Make a quote for the booking’s own stay.',
        );
      }
    }

    // (R5 retest) A hold with no booking behind it reserves the unit by itself, so it must
    // not land on nights that are already booked or closed for a repair. (One attached to
    // a booking rides that booking's own, already-checked dates.)
    if (dto.room_id && !dto.reservation_id) {
      const free = await this.repository.unitFreeForHold(dto.room_id, quote.check_in_date, quote.check_out_date);
      if (!free) {
        throw AppError.conflict(
          'That unit isn’t free for this quote’s dates — it’s booked, or closed for a repair, on some of those nights. Choose another unit or other dates.',
        );
      }
    }

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
      if (isHoldConflict(err)) throw AppError.conflict(holdConflictMessage(err));
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
  async releaseExpired(scope?: { propertyIds: string[] | null; meta: HoldRequestMeta }): Promise<number> {
    return this.repository.releaseExpired(scope);
  }
}
