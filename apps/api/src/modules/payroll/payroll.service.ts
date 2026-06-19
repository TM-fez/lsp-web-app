import { PayrollRepository } from './payroll.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type {
  EmployeePay, PayFrequency, UpsertCompensationDTO, PayrollRequestMeta,
} from './payroll.types.js';

function monthlyEquivalent(gross: number, freq: PayFrequency): number {
  return freq === 'WEEKLY' ? Math.round((gross * 52) / 12) : gross;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export class PayrollService {
  constructor(private readonly repo: PayrollRepository) {}

  async listEmployees(): Promise<EmployeePay[]> {
    const rows = await this.repo.listEmployees();
    return rows.map((r) => {
      const gross = r.gross_amount ?? null;
      const freq = (r.frequency as PayFrequency | null) ?? null;
      return {
        user_id: r.user_id,
        name: r.name,
        role: r.role,
        is_lead: r.is_lead,
        job_title: r.job_title ?? null,
        gross_amount: gross,
        frequency: freq,
        monthly_equivalent: gross !== null && freq ? monthlyEquivalent(gross, freq) : null,
        payment_method: r.payment_method ?? null,
        bank_name: r.bank_name ?? null,
        bank_account: r.bank_account ?? null,
        start_date: (r.start_date as string | null) ?? null,
        active: r.comp_active ?? false,
        notes: r.notes ?? null,
      };
    });
  }

  async summary() {
    const [s, byRole] = await Promise.all([this.repo.summary(), this.repo.byRole()]);
    return {
      headcount: Number(s.headcount),
      monthly_total: Number(s.monthly_total ?? 0),
      by_role: byRole.map((b) => ({
        role: b.role,
        headcount: Number(b.headcount),
        monthly: Number(b.monthly ?? 0),
      })),
    };
  }

  async upsertCompensation(userId: string, dto: UpsertCompensationDTO, meta: PayrollRequestMeta) {
    const fields = {
      job_title: dto.job_title ?? null,
      gross_amount: dto.gross_amount,
      frequency: dto.frequency,
      payment_method: dto.payment_method ?? null,
      bank_name: dto.bank_name ?? null,
      bank_account: dto.bank_account ?? null,
      start_date: dto.start_date ?? null,
      ...(dto.active !== undefined ? { active: dto.active } : {}),
      notes: dto.notes ?? null,
    };
    const row = await this.repo.upsert(userId, fields, meta);
    if (!row) throw AppError.internal('Failed to save compensation');
    return row;
  }

  /** Post the month's payroll total as a single PAYROLL operating cost. */
  async postToOperatingCosts(month: string | undefined, meta: PayrollRequestMeta) {
    const m = month ?? new Date().toISOString().slice(0, 7);
    if (await this.repo.payrollPostedFor(m)) {
      throw AppError.conflict(`Payroll for ${m} has already been posted to operating costs`);
    }
    const { monthly_total } = await this.repo.summary();
    const amount = Number(monthly_total ?? 0);
    if (amount <= 0) throw AppError.badRequest('No active salaries to post');

    const [y, mo] = m.split('-').map(Number);
    const incurredOn = new Date(Date.UTC(y!, mo!, 0)); // last day of the month
    const description = `Payroll — ${MONTHS[mo! - 1]} ${y}`;
    const id = await this.repo.postPayrollOpex(m, incurredOn, amount, description, meta);
    return { operating_expense_id: id, month: m, amount };
  }
}
