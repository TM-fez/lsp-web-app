import { ExpensesRepository } from './expenses.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { Expense, ExpenseStatus, ExpensesRequestMeta } from './expenses.types.js';

function statusOf(row: { cost_approved_at: Date | null; cost_reconciled_at: Date | null }): ExpenseStatus {
  if (row.cost_reconciled_at) return 'RECONCILED';
  if (row.cost_approved_at) return 'APPROVED';
  return 'PENDING';
}

export class ExpensesService {
  constructor(private readonly repo: ExpensesRepository) {}

  async list(status?: ExpenseStatus): Promise<Expense[]> {
    const rows = await this.repo.list(status);
    return rows.map((r) => ({
      id: r.id,
      room_id: r.room_id,
      room_code: r.room_code,
      title: r.title,
      contractor_name: r.contractor_name,
      cost_amount: r.cost_amount as number,
      status: statusOf(r),
      cost_approved_by_name: r.cost_approved_by_name,
      cost_approved_at: r.cost_approved_at,
      cost_reconciled_by_name: r.cost_reconciled_by_name,
      cost_reconciled_at: r.cost_reconciled_at,
      opened_at: r.opened_at,
    }));
  }

  /** Manager sign-off — no spend without approval. */
  async approve(id: string, meta: ExpensesRequestMeta) {
    const e = await this.repo.findById(id);
    if (!e || e.deleted_at || e.cost_amount == null) throw AppError.notFound('Expense not found');
    if (e.cost_approved_at) throw AppError.conflict('This spend has already been approved');
    return this.repo.approveSpend(id, meta);
  }

  /** Accounts matches the (approved) payment against the bank. */
  async reconcile(id: string, meta: ExpensesRequestMeta) {
    const e = await this.repo.findById(id);
    if (!e || e.deleted_at || e.cost_amount == null) throw AppError.notFound('Expense not found');
    if (!e.cost_approved_at) throw AppError.conflict('Approve the spend before reconciling it');
    if (e.cost_reconciled_at) throw AppError.conflict('This expense is already reconciled');
    return this.repo.reconcile(id, meta);
  }
}
