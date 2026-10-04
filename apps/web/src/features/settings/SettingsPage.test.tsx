import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

// Settings: everyone may change their own password; only admins see (and edit) the
// business details and rules. An empty rule field means "use the default", sent as null.

const settings = {
  company_name: 'Lifestyle Apartments', company_address: null, company_phone: null, company_email: null,
  vat_number: 'P0123456', bank_name: null, bank_account_name: null, bank_account_number: null, bank_branch_code: null,
  invoice_footer: null, invoice_terms_days: null, website_hold_hours: 12, updated_at: '2026-10-03T08:00:00Z',
  defaults: { company_name: 'Lifestyle Apartments', invoice_terms_days: 7, website_hold_hours: 24 },
};
const update = vi.fn();
const change = vi.fn();
vi.mock('./hooks', () => ({
  useSettings: () => ({ data: settings, isLoading: false, isError: false, refetch: () => {} }),
  useUpdateSettings: () => ({ mutateAsync: update, isPending: false }),
  useChangePassword: () => ({ mutateAsync: change, isPending: false }),
}));

import { SettingsPage } from './SettingsPage';

const withPerms = (permissions: string[]) =>
  useAuthStore.setState({ accessToken: 't', user: { id: 'u1', name: 'X', email: 'x@x', role: 'admin', permissions } as never });

describe('SettingsPage', () => {
  beforeEach(() => {
    update.mockReset();
    change.mockReset();
  });

  it('shows staff only their password, not the business settings', () => {
    withPerms([]);
    render(<SettingsPage />);
    expect(screen.getByText('My account')).toBeInTheDocument();
    expect(screen.queryByText('Business details')).not.toBeInTheDocument();
    expect(screen.queryByText('Business rules')).not.toBeInTheDocument();
  });

  it('only lets a password change through when the new one meets the rules and is typed twice', () => {
    withPerms([]);
    render(<SettingsPage />);
    const submit = screen.getByRole('button', { name: /Change password/ });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Old@1234' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'weak' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Better@2026' } });
    fireEvent.change(screen.getByLabelText('Type the new password again'), { target: { value: 'Better@2025' } });
    expect(screen.getByText('The two new passwords don’t match.')).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type the new password again'), { target: { value: 'Better@2026' } });
    fireEvent.click(submit);
    expect(change).toHaveBeenCalledWith({ current_password: 'Old@1234', new_password: 'Better@2026' });
  });

  it('shows admins the business details, with the default in force for an empty rule', () => {
    withPerms(['settings.read', 'settings.update']);
    render(<SettingsPage />);
    expect(screen.getByLabelText('VAT number')).toHaveValue('P0123456');
    expect(screen.getByLabelText('Payment terms (days)')).toHaveValue('');
    expect(screen.getByText(/default \(7 days\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Website booking hold (hours)')).toHaveValue('12');
  });

  it('saves an emptied rule as null (back to the default) and refuses an out-of-range one', () => {
    withPerms(['settings.read', 'settings.update']);
    render(<SettingsPage />);
    const save = screen.getByRole('button', { name: /Save business rules/ });
    fireEvent.change(screen.getByLabelText('Payment terms (days)'), { target: { value: '120' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Payment terms (days)'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Website booking hold (hours)'), { target: { value: '' } });
    fireEvent.click(save);
    expect(update).toHaveBeenCalledWith({ invoice_terms_days: 14, website_hold_hours: null });
  });
});
