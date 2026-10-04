import { describe, it, expect } from 'vitest';
import { MAX_MONEY_THEBE } from '../../../src/core/money/limits.js';
import { SetCostSchema, CreateWorkOrderSchema } from '../../../src/modules/maintenance/maintenance.types.js';
import { CreateOperatingExpenseSchema, CreateRecurringSchema } from '../../../src/modules/operating-expenses/operating-expenses.types.js';
import { UpsertCompensationSchema } from '../../../src/modules/payroll/payroll.types.js';
import { CreateRatePlanSchema, UpdateRatePlanSchema, ratesOutOfOrder } from '../../../src/modules/pricing/pricing.types.js';

// (Round 4, N-10) One ceiling for every money field, so a typo cannot reach the books.
describe('money ceilings', () => {
  it('is P1,000,000 in thebe', () => expect(MAX_MONEY_THEBE).toBe(100_000_000));

  it('maintenance cost accepts the ceiling and refuses one thebe more', () => {
    expect(SetCostSchema.safeParse({ cost_amount: MAX_MONEY_THEBE }).success).toBe(true);
    expect(SetCostSchema.safeParse({ cost_amount: MAX_MONEY_THEBE + 1 }).success).toBe(false);
    expect(CreateWorkOrderSchema.safeParse({ room_id: '11111111-1111-4111-8111-111111111111', title: 'x', cost_amount: MAX_MONEY_THEBE + 1 }).success).toBe(false);
  });

  it('maintenance free text is bounded', () => {
    expect(CreateWorkOrderSchema.safeParse({ room_id: '11111111-1111-4111-8111-111111111111', title: 'x', description: 'a'.repeat(5001) }).success).toBe(false);
  });

  it('operating costs, recurring templates and salaries refuse more than the ceiling', () => {
    expect(CreateOperatingExpenseSchema.safeParse({ category: 'UTILITIES', description: 'x', amount: MAX_MONEY_THEBE + 1, incurred_on: '2033-07-11' }).success).toBe(false);
    expect(CreateRecurringSchema.safeParse({ category: 'UTILITIES', description: 'x', amount: MAX_MONEY_THEBE + 1, day_of_month: 1 }).success).toBe(false);
    expect(UpsertCompensationSchema.safeParse({ gross_amount: MAX_MONEY_THEBE + 1, frequency: 'MONTHLY' }).success).toBe(false);
    expect(UpsertCompensationSchema.safeParse({ gross_amount: MAX_MONEY_THEBE, frequency: 'MONTHLY' }).success).toBe(true);
  });

  it('rate plans: ceiling and ladder order', () => {
    const ok = { unit_type: 'STANDARD', name: 'n', nightly_rate: 100, weekly_rate: 600, monthly_rate: 2400 };
    expect(CreateRatePlanSchema.safeParse(ok).success).toBe(true);
    expect(CreateRatePlanSchema.safeParse({ ...ok, weekly_rate: 99 }).success).toBe(false);
    expect(CreateRatePlanSchema.safeParse({ ...ok, monthly_rate: 599 }).success).toBe(false);
    expect(CreateRatePlanSchema.safeParse({ ...ok, nightly_rate: MAX_MONEY_THEBE + 1 }).success).toBe(false);
    // an update naming only one rate is judged later, against the stored plan
    expect(UpdateRatePlanSchema.safeParse({ weekly_rate: 1 }).success).toBe(true);
    expect(UpdateRatePlanSchema.safeParse({ nightly_rate: 500, weekly_rate: 100 }).success).toBe(false);
    expect(ratesOutOfOrder({ nightly_rate: 5, weekly_rate: 5, monthly_rate: 5 })).toBeNull();
  });
});
