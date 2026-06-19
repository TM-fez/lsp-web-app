import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

vi.mock('@/lib/api/properties', () => ({ listProperties: () => Promise.resolve([]) }));
vi.mock('./hooks', () => ({
  useRecurring: () => ({
    data: [{ id: 'r1', property_id: null, property_name: null, category: 'RENT', description: 'Monthly rent', vendor: 'Landlord', amount: 3_800_000, day_of_month: 1, active: true, notes: null }],
    isLoading: false, isError: false, refetch: () => {},
  }),
  useCreateRecurring: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRecurring: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRecurring: () => ({ mutate: vi.fn(), isPending: false }),
  useGenerateRecurring: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { RecurringView } from './RecurringView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RecurringView /></QueryClientProvider>);
}

describe('RecurringView', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'u', name: 'A', email: 'a@lsp.local', role: 'admin', permissions: ['opex.read', 'opex.create', 'opex.update', 'opex.delete'] } as never,
    });
  });

  it('lists recurring templates with generate + add controls', () => {
    renderView();
    expect(screen.getByText('Monthly rent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate/ })).toBeInTheDocument();
    expect(screen.getByText('Add recurring')).toBeInTheDocument();
  });
});
