import { OperatingExpensesRepository } from './operating-expenses.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import { todayInPropertyTZ } from '../../core/time.js';
import type {
  CreateOperatingExpenseDTO,
  UpdateOperatingExpenseDTO,
  OperatingExpenseFilters,
  OperatingExpensesRequestMeta,
  CreateRecurringDTO,
  UpdateRecurringDTO,
} from './operating-expenses.types.js';

/**
 * (Audit 2026-10-11, M-7) `payroll:…` and `recurring:…` notes are the markers the payroll
 * posting and the recurring-cost generator use to know a month is done. Typed by hand, they
 * could close another property's month. Only the system writes them.
 */
function assertNotReservedNote(notes: string | null | undefined): void {
  if (notes && /^\s*(payroll|recurring):/i.test(notes)) {
    throw AppError.badRequest('Notes can’t start with “payroll:” or “recurring:” — those are kept for the system.');
  }
}

export class OperatingExpensesService {
  constructor(private readonly repository: OperatingExpensesRepository) {}

  list(filters: OperatingExpenseFilters) {
    return this.repository.list(filters);
  }

  /**
   * (Audit 2026-10-11, L-10) The receipt files under this cost's property, so attaching another
   * property's (or the company's) document here moved it into view. Your own upload, or you see
   * every property.
   */
  private async assertReceiptLinkable(fileId: string | null | undefined, userId: string): Promise<void> {
    if (fileId && !(await this.repository.fileLinkableBy(fileId, userId))) {
      throw AppError.badRequest('That receipt couldn’t be found. Upload it again.');
    }
  }

  async get(id: string) {
    const row = await this.repository.findById(id);
    if (!row) throw AppError.notFound(`Operating expense ${id} not found`);
    return row;
  }

  async create(dto: CreateOperatingExpenseDTO, meta: OperatingExpensesRequestMeta) {
    assertNotReservedNote(dto.notes);
    await this.assertReceiptLinkable(dto.receipt_file_id, meta.userId);
    return this.repository.create(
      {
        property_id: dto.property_id ?? null,
        category: dto.category,
        description: dto.description,
        vendor: dto.vendor ?? null,
        amount: dto.amount,
        currency: dto.currency ?? 'BWP',
        incurred_on: dto.incurred_on,
        notes: dto.notes ?? null,
        receipt_file_id: dto.receipt_file_id ?? null,
        created_by: meta.userId,
        updated_by: meta.userId,
      },
      meta,
    );
  }

  async update(id: string, dto: UpdateOperatingExpenseDTO, meta: OperatingExpensesRequestMeta) {
    if (dto.notes !== undefined || dto.receipt_file_id !== undefined) {
      // Re-saving sends the marker and the receipt back unchanged — only a change is checked.
      const existing = await this.repository.findById(id);
      if (!existing) throw AppError.notFound(`Operating expense ${id} not found`);
      if (dto.notes !== undefined && dto.notes !== existing.notes) assertNotReservedNote(dto.notes);
      if (dto.receipt_file_id !== undefined && dto.receipt_file_id !== existing.receipt_file_id) {
        await this.assertReceiptLinkable(dto.receipt_file_id, meta.userId);
      }
    }
    const patch = {
      ...(dto.property_id !== undefined ? { property_id: dto.property_id } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.vendor !== undefined ? { vendor: dto.vendor } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.incurred_on !== undefined ? { incurred_on: dto.incurred_on } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(dto.receipt_file_id !== undefined ? { receipt_file_id: dto.receipt_file_id } : {}),
    };
    const updated = await this.repository.update(id, patch, meta);
    if (!updated) throw AppError.notFound(`Operating expense ${id} not found`);
    return updated;
  }

  async remove(id: string, meta: OperatingExpensesRequestMeta) {
    const ok = await this.repository.softDelete(id, meta);
    if (!ok) throw AppError.notFound(`Operating expense ${id} not found`);
  }

  // ── Recurring templates ───────────────────────────────────────────────────────
  listRecurring(accessibleIds?: string[] | null) {
    return this.repository.listRecurring(accessibleIds);
  }

  createRecurring(dto: CreateRecurringDTO, meta: OperatingExpensesRequestMeta) {
    return this.repository.createRecurring(
      {
        property_id: dto.property_id ?? null,
        category: dto.category,
        description: dto.description,
        vendor: dto.vendor ?? null,
        amount: dto.amount,
        ...(dto.day_of_month !== undefined ? { day_of_month: dto.day_of_month } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        notes: dto.notes ?? null,
        created_by: meta.userId,
        updated_by: meta.userId,
      },
      meta,
    );
  }

  async updateRecurring(id: string, dto: UpdateRecurringDTO, meta: OperatingExpensesRequestMeta) {
    const patch = {
      ...(dto.property_id !== undefined ? { property_id: dto.property_id } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.vendor !== undefined ? { vendor: dto.vendor } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.day_of_month !== undefined ? { day_of_month: dto.day_of_month } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };
    const updated = await this.repository.updateRecurring(id, patch, meta);
    if (!updated) throw AppError.notFound(`Recurring cost ${id} not found`);
    return updated;
  }

  async removeRecurring(id: string, meta: OperatingExpensesRequestMeta) {
    const ok = await this.repository.softDeleteRecurring(id, meta);
    if (!ok) throw AppError.notFound(`Recurring cost ${id} not found`);
  }

  /** Generate this month's (or the given month's) operating costs from the templates. */
  /**
   * `accessibleIds` limits which templates run: null = all (admin / every-property user),
   * otherwise only templates of those properties — never company-level ones.
   */
  generate(month: string | undefined, accessibleIds: string[] | null, meta: OperatingExpensesRequestMeta) {
    const m = month ?? todayInPropertyTZ().slice(0, 7);
    return this.repository.generateForMonth(m, meta, accessibleIds).then((r) => ({ month: m, ...r }));
  }
}
