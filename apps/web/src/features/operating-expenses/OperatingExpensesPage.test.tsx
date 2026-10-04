import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

vi.mock('@/lib/api/properties', () => ({ listProperties: () => Promise.resolve([]) }));
const createMutate = vi.hoisted(() => vi.fn());
vi.mock('./hooks', () => ({
  useOperatingExpenses: () => ({
    data: [{
      id: 'o1', property_id: null, property_name: null, category: 'RENT',
      description: 'Monthly rent', vendor: 'Landlord', amount: 3_800_000, currency: 'BWP',
      incurred_on: '2026-06-01', notes: null, created_at: '', updated_at: '',
    }],
    isLoading: false, isError: false, refetch: () => {},
  }),
  useCreateOperatingExpense: () => ({ mutate: createMutate, isPending: false }),
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

  // Re-test 3: a fast double click on "Add cost" saved the cost twice.
  it('saves once however fast "Add cost" is double-clicked', () => {
    createMutate.mockReset();
    renderPage();
    fireEvent.click(screen.getByText('Add cost'));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Electricity' } });
    fireEvent.change(screen.getByLabelText('Amount (Pula)'), { target: { value: '120.50' } });
    const save = screen.getAllByRole('button', { name: 'Add cost' }).at(-1)!;
    fireEvent.click(save);
    fireEvent.click(save);
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  // Round 4 N-5/N-2.
  it('sends the amount in thebe with an Idempotency-Key, one per cost being entered', () => {
    createMutate.mockReset();
    renderPage();
    fireEvent.click(screen.getByText('Add cost'));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Electricity' } });
    fireEvent.change(screen.getByLabelText('Amount (Pula)'), { target: { value: '120.50' } });
    const save = screen.getAllByRole('button', { name: 'Add cost' }).at(-1)!;
    fireEvent.click(save);
    const [vars] = createMutate.mock.calls[0]!;
    expect(vars.input.amount).toBe(12_050);
    expect(vars.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('refuses a decimal comma — "120,5" is not P1,205 — and will not save', () => {
    createMutate.mockReset();
    renderPage();
    fireEvent.click(screen.getByText('Add cost'));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Electricity' } });
    fireEvent.change(screen.getByLabelText('Amount (Pula)'), { target: { value: '120,5' } });
    expect(screen.getByText('Use a dot for decimals, e.g. 10.50')).toBeInTheDocument();
    const save = screen.getAllByRole('button', { name: 'Add cost' }).at(-1)!;
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(createMutate).not.toHaveBeenCalled();
  });
});
