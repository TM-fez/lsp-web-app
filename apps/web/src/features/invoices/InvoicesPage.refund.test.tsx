import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

// The refund dialog, after Round 4: the amount box takes dots only (a decimal comma used to
// become ten times the amount), the button is dead while the request is in flight, and every
// dialog open mints ONE Idempotency-Key that every submit from that open carries.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const refundMutate = vi.fn();
let refundPending = false;

const paid = {
  id: 'inv-paid', number: 'INV-DEMO-00002', hold_id: null, quote_id: null, reservation_id: 'r1',
  kind: 'BALANCE', currency: 'BWP', subtotal_amount: 0, tax_rate_bps: 0, tax_amount: 0,
  total_amount: 65_000, refunded_amount: 15_000, status: 'PAID', receipt_file_id: null,
  created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
  bill_to_name: null, guest_name: 'Neo Kgosi', unit_code: 'G4',
  check_in_date: null, check_out_date: null, due_date: '2026-06-08', is_overdue: false,
};

vi.mock('./hooks', () => ({
  useInvoices: () => ({
    data: { data: [paid], total: 1, page: 1, limit: 100, totals: { outstanding_amount: 0, outstanding_count: 0, overdue_amount: 0, overdue_count: 0 } },
    isLoading: false, isError: false, refetch: () => {},
  }),
  useSettleInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useRefundInvoice: () => ({ mutate: refundMutate, isPending: refundPending }),
  useActiveQuotes: () => ({ data: [], isLoading: false, isError: false }),
  useIssueInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { InvoicesPage } from './InvoicesPage';

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'Refund' }));
const amountBox = () => screen.getByLabelText('Amount (Pula)') as HTMLInputElement;
const reasonBox = () => screen.getByLabelText('Reason');
const submitBtn = () => screen.getByRole('button', { name: 'Record refund' });

describe('InvoicesPage — refund dialog', () => {
  beforeEach(() => {
    refundMutate.mockClear();
    refundPending = false;
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'u', name: 'Admin', email: 'a@lsp.local', role: 'admin', permissions: ['invoices.update', 'invoices.refund'] } as never,
    });
  });

  // (R10 #2) Empty, not prefilled with everything — the limit is said, and shown as a hint.
  it('starts empty, saying what is still refundable (total − already refunded)', () => {
    render(<InvoicesPage />);
    openDialog();
    expect(amountBox().value).toBe('');
    expect(amountBox().placeholder).toBe('up to 500.00');
    expect(screen.getByText(/Up to BWP 500\.00 can still be refunded/)).toBeInTheDocument();
    fireEvent.change(reasonBox(), { target: { value: 'x' } });
    expect(submitBtn()).toBeDisabled();
  });

  // (R10 #1) The server asks before a refund that would make a live stay free; the dialog
  // shows the question and sends the same refund again, answered, only on "Yes".
  it('asks the server’s "makes the stay free" question and resends with the answer', () => {
    render(<InvoicesPage />);
    openDialog();
    fireEvent.change(reasonBox(), { target: { value: 'guest asked' } });
    fireEvent.change(amountBox(), { target: { value: '500.00' } });
    fireEvent.click(submitBtn());
    const question = { response: { status: 409, data: { error: 'Full Refund', message: 'This refunds everything and makes the stay free.' } } };
    act(() => {
      refundMutate.mock.calls[0]![1].onError(question);
      refundMutate.mock.calls[0]![1].onSettled();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('makes the stay free');
    fireEvent.click(screen.getByRole('button', { name: 'Yes — refund anyway' }));
    expect(refundMutate).toHaveBeenCalledTimes(2);
    expect(refundMutate.mock.calls[1]![0]).toMatchObject({ amount: 50_000, confirmFullRefund: true });
    // Same open, same key: the first try was refused, so nothing was recorded under it.
    expect(refundMutate.mock.calls[1]![0].idempotencyKey).toBe(refundMutate.mock.calls[0]![0].idempotencyKey);
  });

  it('refuses a decimal comma — "10,5" is not P105 — and disables the button', () => {
    render(<InvoicesPage />);
    openDialog();
    fireEvent.change(reasonBox(), { target: { value: 'goodwill' } });
    fireEvent.change(amountBox(), { target: { value: '10,5' } });
    expect(screen.getByText('Use a dot for decimals, e.g. 10.50')).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
    fireEvent.click(submitBtn());
    expect(refundMutate).not.toHaveBeenCalled();
  });

  it('refuses thousands separators', () => {
    render(<InvoicesPage />);
    openDialog();
    fireEvent.change(reasonBox(), { target: { value: 'x' } });
    fireEvent.change(amountBox(), { target: { value: '1,250' } });
    expect(screen.getByText('Leave out thousands separators, e.g. 1250.50')).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });

  it('refuses more than is still refundable (not the invoice total) — by one thebe', () => {
    render(<InvoicesPage />);
    openDialog();
    fireEvent.change(reasonBox(), { target: { value: 'x' } });
    fireEvent.change(amountBox(), { target: { value: '500.01' } });
    expect(screen.getByText(/Only BWP 500\.00 can still be refunded/)).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
    fireEvent.change(amountBox(), { target: { value: '500.00' } });
    expect(submitBtn()).toBeEnabled();
  });

  it('sends the amount in thebe with an Idempotency-Key', () => {
    render(<InvoicesPage />);
    openDialog();
    fireEvent.change(reasonBox(), { target: { value: '  guest left early ' } });
    fireEvent.change(amountBox(), { target: { value: '10.5' } });
    fireEvent.click(submitBtn());
    expect(refundMutate).toHaveBeenCalledTimes(1);
    const [vars] = refundMutate.mock.calls[0]!;
    expect(vars).toEqual({ id: 'inv-paid', amount: 1050, reason: 'guest left early', idempotencyKey: expect.stringMatching(UUID), confirmFullRefund: false });
  });

  it('keeps the same key for every submit within one open, and mints a new one on the next open', () => {
    render(<InvoicesPage />);
    openDialog();
    fireEvent.change(reasonBox(), { target: { value: 'x' } });
    fireEvent.change(amountBox(), { target: { value: '10' } });
    fireEvent.click(submitBtn());
    // The first attempt failed (settled without success) — a retry reuses the same key.
    act(() => refundMutate.mock.calls[0]![1].onSettled());
    fireEvent.click(submitBtn());
    const keys = refundMutate.mock.calls.map((c) => c[0].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);

    act(() => refundMutate.mock.calls[1]![1].onSettled());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    openDialog();
    fireEvent.change(reasonBox(), { target: { value: 'x' } });
    fireEvent.change(amountBox(), { target: { value: '10' } });
    fireEvent.click(submitBtn());
    expect(refundMutate.mock.calls[2]![0].idempotencyKey).toMatch(UUID);
    expect(refundMutate.mock.calls[2]![0].idempotencyKey).not.toBe(keys[0]);
  });

  it('is disabled while the request is in flight, and a click then sends nothing', () => {
    render(<InvoicesPage />);
    openDialog();
    fireEvent.change(reasonBox(), { target: { value: 'x' } });
    fireEvent.change(amountBox(), { target: { value: '10' } });
    refundPending = true;
    // re-render with the mutation pending
    fireEvent.change(reasonBox(), { target: { value: 'xy' } });
    expect(submitBtn()).toBeDisabled();
    fireEvent.click(submitBtn());
    expect(refundMutate).not.toHaveBeenCalled();
  });

  // (R5 retest) Two clicks in the same tick used to both go out (one refund thanks to the
  // key, but "Refund recorded" twice). Only the first is sent now.
  it('sends one request for a double click, before the pending state has rendered', () => {
    render(<InvoicesPage />);
    openDialog();
    fireEvent.change(reasonBox(), { target: { value: 'x' } });
    fireEvent.change(amountBox(), { target: { value: '10' } });
    fireEvent.click(submitBtn());
    fireEvent.click(submitBtn());
    expect(refundMutate).toHaveBeenCalledTimes(1);
  });
});
