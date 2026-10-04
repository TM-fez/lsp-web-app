import { PayrollRepository } from './payroll.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { PropertyScope } from '../../core/scope/propertyScope.js';
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

  async listEmployees(scope: PropertyScope): Promise<EmployeePay[]> {
    const rows = await this.repo.listEmployees(scope);
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

  async summary(scope: PropertyScope) {
    const [s, byRole] = await Promise.all([this.repo.summary(scope), this.repo.byRole(scope)]);
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

  async upsertCompensation(userId: string, dto: UpsertCompensationDTO, scope: PropertyScope, meta: PayrollRequestMeta) {
    // Someone outside the caller's properties is "not found" — same as every other scoped by-id route.
    if (!(await this.repo.employeeVisible(userId, scope))) throw AppError.notFound('Staff member not found');
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

  /**
   * Post the month's payroll as operating costs.
   * - all-property caller (admin, or member of every property): ONE company-level cost
   *   (no property) for everyone — unchanged behaviour.
   * - property-limited caller: one cost PER caller property, covering only staff who work in
   *   those properties, never a company-level cost (they cannot even see those).
   */
  async postToOperatingCosts(month: string | undefined, scope: PropertyScope, meta: PayrollRequestMeta) {
    const m = month ?? new Date().toISOString().slice(0, 7);
    if (await this.repo.payrollPostedFor(m, scope)) {
      throw AppError.conflict(`Payroll for ${m} has already been posted to operating costs`);
    }

    const [y, mo] = m.split('-').map(Number);
    const incurredOn = new Date(Date.UTC(y!, mo!, 0)); // last day of the month
    const label = `Payroll — ${MONTHS[mo! - 1]} ${y}`;

    if (scope.allProperties) {
      const { monthly_total } = await this.repo.summary(scope);
      const amount = Number(monthly_total ?? 0);
      if (amount <= 0) throw AppError.badRequest('No active salaries to post');
      const [id] = await this.repo.postPayrollOpex(m, incurredOn, [{ propertyId: null, amount, description: label }], meta);
      return { operating_expense_id: id!, operating_expense_ids: [id!], month: m, amount };
    }

    const shares = (await this.repo.monthlyByCallerProperty(scope)).filter((s) => s.monthly > 0);
    if (shares.length === 0) throw AppError.badRequest('No active salaries to post');
    const names = await this.repo.propertyNames(shares.map((s) => s.property_id));
    const ids = await this.repo.postPayrollOpex(
      m,
      incurredOn,
      shares.map((s) => ({
        propertyId: s.property_id,
        amount: s.monthly,
        description: `${label} — ${names.get(s.property_id) ?? 'property'}`,
      })),
      meta
    );
    return {
      operating_expense_id: ids[0]!,
      operating_expense_ids: ids,
      month: m,
      amount: shares.reduce((t, s) => t + s.monthly, 0),
    };
  }
}
