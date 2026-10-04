import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaymentIntent } from '@/types';

// The screen exists so an asynchronous failure is not invisible. What matters is that a
// failed payment is what you see first, and that the recorded reason is readable.

const row = (over: Partial<PaymentIntent>): PaymentIntent => ({
  id: 'p1', hold_id: 'h1', quote_id: 'q1', invoice_id: null, purpose: 'DEPOSIT',
  amount: 325000, currency: 'BWP', method: 'CARD', status: 'PAID',
  attempts: 1, max_attempts: 3, last_error: null, paid_at: null,
  created_at: '2026-09-01T08:00:00Z',
  guest_name: 'Neo Kgosi', unit_code: 'B2', reservation_id: 'r1',
  ...over,
});

let rows: PaymentIntent[] = [];
const seed: PaymentIntent[] = [
  row({ id: 'ok', guest_name: 'Neo Kgosi', status: 'PAID' }),
  // Settled from the Invoices page, which never asked how the guest paid.
  row({ id: 'inv', guest_name: 'Tebogo Sithole', status: 'PAID', method: 'OTHER', hold_id: null, invoice_id: 'i9' }),
  row({
    id: 'bad', guest_name: 'Charity Chipondeni', status: 'FAILED', attempts: 3,
    last_error: 'Card declined by issuer',
  }),
];

const detail = vi.fn();

vi.mock('./hooks', () => ({
  usePayments: () => ({
    data: { data: rows, total: rows.length, page: 1, limit: 100 },
    isLoading: false, isError: false, refetch: () => {},
  }),
  usePayment: (id: string | null) => {
    detail(id);
    return {
      data: id
        ? { ...rows.find((r) => r.id === id)!, attempts_log: [
            { id: 'a1', payment_intent_id: id, attempt_no: 1, outcome: 'FAILURE',
              method: 'CARD', reference: 'AUTH-9', note: null, created_at: '2026-09-01T08:05:00Z' },
          ] }
        : undefined,
      isLoading: false, isError: false,
    };
  },
}));

import { PaymentsPage } from './PaymentsPage';

describe('PaymentsPage', () => {
  beforeEach(() => {
    detail.mockClear();
    rows = seed;
  });

  // A screen that opens on a wall of successful payments buries the one that failed.
  it('opens on what needs chasing, not on everything', () => {
    render(<PaymentsPage />);
    expect(screen.getByText('Charity Chipondeni')).toBeInTheDocument();
    expect(screen.queryByText('Neo Kgosi')).not.toBeInTheDocument();
  });

  // Re-test 2026-10-04: with nothing failed, "Needs attention" is empty — opening on it
  // made the page read as broken right after payments were recorded.
  it('opens on All when nothing needs attention', () => {
    rows = seed.filter((r) => r.status === 'PAID');
    render(<PaymentsPage />);
    expect(screen.getByText('Neo Kgosi')).toBeInTheDocument();
    expect(screen.getByText('Tebogo Sithole')).toBeInTheDocument();
  });

  it('labels a settlement with no recorded method honestly, not as raw OTHER', () => {
    render(<PaymentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.queryByText('OTHER')).not.toBeInTheDocument();
  });

  it('counts what needs attention on the tab', () => {
    render(<PaymentsPage />);
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('shows every payment once All is chosen', () => {
    render(<PaymentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Neo Kgosi')).toBeInTheDocument();
    expect(screen.getByText('Charity Chipondeni')).toBeInTheDocument();
  });

  // last_error has been recorded since the module was written and had no screen.
  it('surfaces the recorded failure reason and the attempt log', async () => {
    render(<PaymentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => expect(screen.getByText('Card declined by issuer')).toBeInTheDocument());
    expect(screen.getByText(/Attempts \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/ref AUTH-9/)).toBeInTheDocument();
  });

  it('does not fetch a detail until one is opened', () => {
    render(<PaymentsPage />);
    expect(detail).toHaveBeenCalledWith(null);
  });
});
