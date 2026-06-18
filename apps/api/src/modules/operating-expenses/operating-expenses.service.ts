import { OperatingExpensesRepository } from './operating-expenses.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type {
  CreateOperatingExpenseDTO,
  UpdateOperatingExpenseDTO,
  OperatingExpenseFilters,
  OperatingExpensesRequestMeta,
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
}
