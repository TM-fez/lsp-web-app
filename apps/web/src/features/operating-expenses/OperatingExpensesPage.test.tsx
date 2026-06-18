import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

vi.mock('@/lib/api/properties', () => ({ listProperties: () => Promise.resolve([]) }));
vi.mock('./hooks', () => ({
  useOperatingExpenses: () => ({
    data: [{
      id: 'o1', property_id: null, property_name: null, category: 'RENT',
      description: 'Monthly rent', vendor: 'Landlord', amount: 3_800_000, currency: 'BWP',
      incurred_on: '2026-06-01', notes: null, created_at: '', updated_at: '',
    }],
    isLoading: false, isError: false, refetch: () => {},
  }),
  useCreateOperatingExpense: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateOperatingExpense: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteOperatingExpense: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { OperatingExpensesPage } from './OperatingExpensesPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OperatingExpensesPage /></QueryClientProvider>);
}

describe('OperatingExpensesPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'u', name: 'A', email: 'a@lsp.local', role: 'admin', permissions: ['opex.read', 'opex.create', 'opex.update', 'opex.delete'] } as never,
    });
  });

  it('lists operating costs with an add control', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Operating costs' })).toBeInTheDocument();
    expect(screen.getByText('Monthly rent')).toBeInTheDocument();
    expect(screen.getByText('Add cost')).toBeInTheDocument();
    expect(screen.getByText('Company-wide')).toBeInTheDocument();   // null property row
  });
});
