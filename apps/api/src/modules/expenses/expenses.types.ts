import type { RequestMeta } from '../auth/auth.types.js';

export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'RECONCILED';

/** A repair cost as Accounts sees it — money only, no maintenance operations. */
export interface Expense {
  id: string; // the work order id the cost lives on
  room_id: string;
  room_code: string | null;
  title: string;
  contractor_name: string | null;
  cost_amount: number; // thebe
  status: ExpenseStatus;
  cost_approved_by_name: string | null;
  cost_approved_at: Date | null;
  cost_reconciled_by_name: string | null;
  cost_reconciled_at: Date | null;
  opened_at: Date;
}

export interface ExpensesRequestMeta extends RequestMeta {
  userId: string;
}
