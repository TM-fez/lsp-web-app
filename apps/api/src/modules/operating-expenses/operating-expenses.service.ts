import { OperatingExpensesRepository } from './operating-expenses.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type {
  CreateOperatingExpenseDTO,
  UpdateOperatingExpenseDTO,
  OperatingExpenseFilters,
  OperatingExpensesRequestMeta,
  CreateRecurringDTO,
  UpdateRecurringDTO,
} from './operating-expenses.types.js';

export class OperatingExpensesService {
  constructor(private readonly repository: OperatingExpensesRepository) {}

  list(filters: OperatingExpenseFilters) {
    return this.repository.list(filters);
  }

  async get(id: string) {
    const row = await this.repository.findById(id);
    if (!row) throw AppError.notFound(`Operating expense ${id} not found`);
    return row;
  }

  create(dto: CreateOperatingExpenseDTO, meta: OperatingExpensesRequestMeta) {
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
        created_by: meta.userId,
        updated_by: meta.userId,
      },
      meta,
    );
  }

  async update(id: string, dto: UpdateOperatingExpenseDTO, meta: OperatingExpensesRequestMeta) {
    const patch = {
      ...(dto.property_id !== undefined ? { property_id: dto.property_id } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.vendor !== undefined ? { vendor: dto.vendor } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.incurred_on !== undefined ? { incurred_on: dto.incurred_on } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
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
  listRecurring() {
    return this.repository.listRecurring();
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
  generate(month: string | undefined, meta: OperatingExpensesRequestMeta) {
    const m = month ?? new Date().toISOString().slice(0, 7);
    return this.repository.generateForMonth(m, meta).then((r) => ({ month: m, ...r }));
  }
}
