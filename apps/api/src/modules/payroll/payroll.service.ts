import { PayrollRepository } from './payroll.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { PropertyScope } from '../../core/scope/propertyScope.js';
import { todayInPropertyTZ } from '../../core/time.js';
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
        home_property_id: r.home_property_id ?? null,
        home_property_name: r.home_property_name ?? null,
        member_properties: r.member_properties ?? [],
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
    // (R5) Where their pay is costed: one of the properties they work in, and — for someone
    // limited to some properties — one of the caller's own. Only an all-property user may
    // make it company-level (null): that moves the cost out of every property's P&L.
    if (dto.home_property_id) {
      if (!(await this.repo.isMemberOf(userId, dto.home_property_id))) {
        throw AppError.badRequest('Choose one of the properties this person works in as their home property.');
      }
      if (!scope.allProperties && !(scope.ids ?? []).includes(dto.home_property_id)) {
        throw AppError.badRequest('Choose one of your own properties as their home property.');
      }
      // (R5 retest) …and a limited user may only move a home they already hold. Otherwise a
      // CBD accountant could pull a shared person's pay off the Village's books onto CBD's.
      if (!scope.allProperties) {
        const current = await this.repo.currentHome(userId);
        if (current !== dto.home_property_id && !(scope.ids ?? []).includes(current ?? '')) {
          throw AppError.forbidden(
            'This person’s pay is costed to a property you don’t manage. Ask someone who works across all properties to move it.',
          );
        }
      }
    } else if (dto.home_property_id === null && !scope.allProperties) {
      throw AppError.badRequest('Only someone who works across all properties can make a salary company-level.');
    }
    const fields = {
      job_title: dto.job_title ?? null,
      gross_amount: dto.gross_amount,
      frequency: dto.frequency,
      payment_method: dto.payment_method ?? null,
      bank_name: dto.bank_name ?? null,
      bank_account: dto.bank_account ?? null,
      start_date: dto.start_date ?? null,
      ...(dto.active !== undefined ? { active: dto.active } : {}),
      ...(dto.home_property_id !== undefined ? { home_property_id: dto.home_property_id } : {}),
      notes: dto.notes ?? null,
    };
    const row = await this.repo.upsert(userId, fields, meta);
    if (!row) throw AppError.internal('Failed to save compensation');
    return row;
  }

  /**
   * Post the month's payroll as operating costs — (R5, migration 086) one cost per HOME
   * property, plus one company-level cost (no property) for staff with no property.
   *
   * Each person is costed once, at their home, whoever posts: an all-property user posts
   * every bucket not yet posted that month; a property-limited user posts only the homes in
   * their own properties. Two accountants posting CBD and the Village separately can no
   * longer both charge the person who works at both (the R4 double count).
   *
   * A company-level marker (`payroll:YYYY-MM`) means the month is closed: either the
   * company bucket was posted along with everything else, or it is a whole-company posting
   * from before R5 that already covered everyone.
   */
  async postToOperatingCosts(month: string | undefined, scope: PropertyScope, meta: PayrollRequestMeta) {
    const m = month ?? todayInPropertyTZ().slice(0, 7);
    const posted = await this.repo.postedMarkers(m);
    const alreadyPosted = () => AppError.conflict(`Payroll for ${m} has already been posted to operating costs`);
    if (posted.has(`payroll:${m}`)) throw alreadyPosted();

    const all = (await this.repo.monthlyByHomeProperty(scope)).filter((s) => s.monthly > 0);
    if (all.length === 0) throw AppError.badRequest('No active salaries to post');
    const shares = all.filter((s) => s.property_id === null || !posted.has(`payroll:${m}:${s.property_id}`));
    if (shares.length === 0) throw alreadyPosted();

    const [y, mo] = m.split('-').map(Number);
    const incurredOn = new Date(Date.UTC(y!, mo!, 0)); // last day of the month
    const label = `Payroll — ${MONTHS[mo! - 1]} ${y}`;
    const names = await this.repo.propertyNames(shares.flatMap((s) => (s.property_id ? [s.property_id] : [])));
    const ids = await this.repo.postPayrollOpex(
      m,
      incurredOn,
      shares.map((s) => ({
        propertyId: s.property_id,
        amount: s.monthly,
        description: s.property_id ? `${label} — ${names.get(s.property_id) ?? 'property'}` : `${label} — company`,
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
