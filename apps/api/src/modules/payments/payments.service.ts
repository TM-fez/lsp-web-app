import { PaymentsRepository } from './payments.repository.js';
import { HoldsRepository } from '../holds/holds.repository.js';
import { HOLD_TTL_MS } from '../holds/holds.service.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { AppError } from '../../core/errors/AppError.js';
import type { PaymentIntentRow, PaymentAttemptRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { CreateQuoteDTO } from '../quotes/quotes.types.js';
import { describeThebe } from '../../core/money/folio.js';
import type { CreatePaymentIntentDTO, AttemptPaymentDTO, PaymentFilters, PaymentMethod, PaymentRequestMeta, PaymentListRow } from './payments.types.js';

export interface DeskPaymentInput {
  reservationId: string;
  roomId: string;
  /** The stay to price for the quote that backs the payment. */
  stay: CreateQuoteDTO;
  /**
   * What the folio would show if nothing were frozen: the booking's own priced total,
   * discount applied. NOT the quote's total — the quote prices the stay at the rack
   * rate and knows nothing of the booking's approved discount.
   */
  pricedTotal: number;
  /** Thebe; omitted = whatever the booking still owes. */
  amount?: number;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
}

const RETRY_EXTENSION_MS = 15 * 60 * 1000;

export class PaymentsService {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly holds: HoldsRepository,
    private readonly quotes: QuotesService
  ) {}

  async getIntent(id: string): Promise<PaymentIntentRow> {
    const intent = await this.repository.findById(id);
    if (!intent) throw AppError.notFound(`Payment intent ${id} not found`);
    return intent;
  }

  async getIntentWithAttempts(id: string): Promise<PaymentIntentRow & { attempts_log: PaymentAttemptRow[] }> {
    const intent = await this.getIntent(id);
    const attempts_log = await this.repository.listAttempts(id);
    return { ...intent, attempts_log };
  }

  async listIntents(
    filters: PaymentFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<PaymentIntentRow & PaymentListRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async createIntent(dto: CreatePaymentIntentDTO, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    const hold = await this.holds.findById(dto.hold_id);
    if (!hold) throw AppError.notFound(`Hold ${dto.hold_id} not found`);
    if (hold.status !== 'HELD') {
      throw AppError.conflict(`Cannot take payment on a ${hold.status} hold`);
    }
    // (Re-test 3) Money taken on a hold with no booking behind it lands on no folio and no
    // invoice — it is simply lost to the books. Every real flow attaches the booking.
    if (!hold.reservation_id) {
      throw AppError.badRequest('This hold isn’t attached to a booking yet. Create or pick the booking first, then take the payment.');
    }

    const quote = await this.quotes.getQuote(hold.quote_id);
    const defaultAmount =
      dto.purpose === 'BALANCE' ? quote.total_amount - quote.deposit_amount : quote.deposit_amount;
    const amount = dto.amount ?? defaultAmount;
    if (amount <= 0) throw AppError.badRequest('Payment amount must be positive');
    // A payment can never be larger than what it pays for. (The binding cap — against what
    // the booking has already received — is enforced under the booking's lock when the
    // payment settles; this refuses the obviously impossible one up front.)
    if (amount > quote.total_amount) {
      throw AppError.badRequest(
        `That payment is more than the quote total (${describeThebe(quote.total_amount)}).`
      );
    }

    return this.repository.create(
      {
        hold_id: hold.id,
        quote_id: hold.quote_id,
        purpose: dto.purpose,
        amount,
        currency: quote.currency,
        method: dto.method,
        max_attempts: dto.max_attempts ?? 3,
        created_by: meta.userId,
        updated_by: meta.userId,
      },
      meta
    );
  }

  /**
   * Take a payment at the desk against a booking, atomically (see
   * PaymentsRepository.recordDeskPayment). Pricing is read here, before the transaction;
   * everything that decides whether the money is accepted is read under the booking's lock.
   */
  async recordDeskPayment(input: DeskPaymentInput, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    const quote = await this.quotes.prepareQuote(input.stay, { userId: meta.userId, ip: meta.ip, requestId: meta.requestId });
    return this.repository.recordDeskPayment(
      {
        reservationId: input.reservationId,
        roomId: input.roomId,
        quote,
        pricedTotal: input.pricedTotal,
        amount: input.amount,
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        holdTtlMs: HOLD_TTL_MS,
      },
      meta
    );
  }

  /**
   * Drive one payment attempt. SUCCESS confirms the hold; FAILURE retries until
   * max_attempts (retry-before-release), then fails and releases the hold.
   * No real gateway — the outcome is supplied by the caller.
   */
  async attempt(id: string, dto: AttemptPaymentDTO, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    const intent = await this.getIntent(id);
    if (intent.status !== 'PENDING' && intent.status !== 'RETRY') {
      throw AppError.conflict(`Payment intent is ${intent.status} and cannot be retried`);
    }

    if (!intent.hold_id) {
      throw AppError.conflict('This payment was recorded against an invoice and cannot be re-attempted');
    }
    const hold = await this.holds.findById(intent.hold_id);
    if (!hold) throw AppError.notFound('Hold for this payment no longer exists');
    if (hold.status !== 'HELD') {
      throw AppError.conflict(`Hold is ${hold.status}; payment cannot proceed`);
    }
    // (Round 4) A hold past its time is dead even if the sweep has not reached it yet. A swept
    // hold already refuses payment; letting the unswept one through made the answer depend on
    // whether the sweep had run. The booking itself is not lost — the desk can still take the
    // money from the booking, which re-checks the dates under the booking's lock.
    if (new Date(hold.held_until).getTime() < Date.now()) {
      throw AppError.conflict(
        'This hold has expired, so the payment cannot go through it. Take the payment from the booking instead (Record payment) — that checks the dates are still free.',
      );
    }

    const base = {
      intentId: intent.id,
      holdId: intent.hold_id,
      reservationId: hold.reservation_id,
      attemptNo: intent.attempts + 1,
      method: intent.method,
      reference: dto.reference ?? null,
      note: dto.note ?? null,
    };

    if (dto.outcome === 'SUCCESS') {
      return this.repository.settlePaid(base, meta);
    }

    const newAttempts = intent.attempts + 1;
    const lastError = dto.note ?? 'payment attempt failed';
    if (newAttempts < intent.max_attempts) {
      return this.repository.recordRetry(
        { ...base, lastError, heldUntil: new Date(Date.now() + RETRY_EXTENSION_MS) },
        meta
      );
    }
    return this.repository.settleFailed({ ...base, lastError }, meta);
  }
}
