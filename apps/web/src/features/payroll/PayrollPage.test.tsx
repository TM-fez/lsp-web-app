import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

vi.mock('./hooks', () => ({
  useEmployees: () => ({
    data: [
      { user_id: 'u1', name: 'Thato Moeng', role: 'housekeeping', is_lead: true, job_title: 'Head Housekeeper', gross_amount: 450_000, frequency: 'MONTHLY', monthly_equivalent: 450_000, payment_method: 'Bank transfer', bank_name: 'FNB', bank_account: '123', start_date: '2025-01-01', active: true, notes: null },
      { user_id: 'u2', name: 'Mpho Tau', role: 'reception', is_lead: false, job_title: null, gross_amount: null, frequency: null, monthly_equivalent: null, payment_method: null, bank_name: null, bank_account: null, start_date: null, active: false, notes: null },
    ],
    isLoading: false, isError: false, refetch: () => {},
  }),
  usePayrollSummary: () => ({ data: { headcount: 1, monthly_total: 450_000, by_role: [{ role: 'housekeeping', headcount: 1, monthly: 450_000 }] } }),
  useUpsertCompensation: () => ({ mutate: vi.fn(), isPending: false }),
  usePostPayroll: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { PayrollPage } from './PayrollPage';

describe('PayrollPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'a', name: 'A', email: 'a@lsp.local', role: 'admin', permissions: ['payroll.read', 'payroll.manage'] } as never,
    });
  });

  it('renders the payroll summary, employees, and pay actions', () => {
    render(<PayrollPage />);
    expect(screen.getByRole('heading', { name: 'Payroll' })).toBeInTheDocument();
    expect(screen.getByText('Monthly payroll')).toBeInTheDocument();
    expect(screen.getByText('Thato Moeng')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();   // u2 has no salary yet
    expect(screen.getByText('Set pay')).toBeInTheDocument();    // u2 action
    expect(screen.getByText('Edit pay')).toBeInTheDocument();   // u1 action
  });
});
