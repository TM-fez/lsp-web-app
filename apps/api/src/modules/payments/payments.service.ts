import { PaymentsRepository } from './payments.repository.js';
import { HoldsRepository } from '../holds/holds.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { AppError } from '../../core/errors/AppError.js';
import type { PaymentIntentRow, PaymentAttemptRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { CreatePaymentIntentDTO, AttemptPaymentDTO, PaymentFilters, PaymentRequestMeta } from './payments.types.js';

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

  async listIntents(filters: PaymentFilters, pagination: PaginationOptions): Promise<PaginatedResult<PaymentIntentRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async createIntent(dto: CreatePaymentIntentDTO, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    const hold = await this.holds.findById(dto.hold_id);
    if (!hold) throw AppError.notFound(`Hold ${dto.hold_id} not found`);
    if (hold.status !== 'HELD') {
      throw AppError.conflict(`Cannot take payment on a ${hold.status} hold`);
    }

    const quote = await this.quotes.getQuote(hold.quote_id);
    const defaultAmount =
      dto.purpose === 'BALANCE' ? quote.total_amount - quote.deposit_amount : quote.deposit_amount;
    const amount = dto.amount ?? defaultAmount;
    if (amount <= 0) throw AppError.badRequest('Payment amount must be positive');

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
   * Drive one payment attempt. SUCCESS confirms the hold; FAILURE retries until
   * max_attempts (retry-before-release), then fails and releases the hold.
   * No real gateway — the outcome is supplied by the caller.
   */
  async attempt(id: string, dto: AttemptPaymentDTO, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    const intent = await this.getIntent(id);
    if (intent.status !== 'PENDING' && intent.status !== 'RETRY') {
      throw AppError.conflict(`Payment intent is ${intent.status} and cannot be retried`);
    }

    const hold = await this.holds.findById(intent.hold_id);
    if (!hold) throw AppError.notFound('Hold for this payment no longer exists');
    if (hold.status !== 'HELD') {
      throw AppError.conflict(`Hold is ${hold.status}; payment cannot proceed`);
    }

    const base = {
      intentId: intent.id,
      holdId: intent.hold_id,
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
