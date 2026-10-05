import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

// (R6 item 20) Pay was saved for someone but "On payroll" was left unticked, so the totals
// stayed P0 with nothing on screen saying why. The row and the summary now say so.
vi.mock('./hooks', () => ({
  useEmployees: () => ({
    data: [
      { user_id: 'u3', name: 'Lesego Dube', role: 'reception', is_lead: false, job_title: null, gross_amount: 300_000, frequency: 'MONTHLY', monthly_equivalent: 300_000, payment_method: 'Cash', bank_name: null, bank_account: null, start_date: null, active: false, notes: null },
    ],
    isLoading: false, isError: false, refetch: () => {},
  }),
  usePayrollSummary: () => ({ data: { headcount: 0, monthly_total: 0, by_role: [] } }),
  useUpsertCompensation: () => ({ mutate: vi.fn(), isPending: false }),
  usePostPayroll: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { PayrollPage } from './PayrollPage';

describe('PayrollPage — pay set but not on payroll', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'a', name: 'A', email: 'a@lsp.local', role: 'admin', permissions: ['payroll.read', 'payroll.manage'] } as never,
    });
  });

  it('marks the row and explains why the totals are P0', () => {
    render(<PayrollPage />);
    expect(screen.getByText('Not on payroll')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      '1 person has pay set but isn’t on payroll, so they aren’t in these totals. Edit their pay and tick “On payroll” to count them.'
    );
  });
});
