import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The money panel, after CONFIRMED was decoupled from paid (owner decision 2026-09-07).
// The booking's status no longer tells you whether it was paid for, so this panel is
// the only place that does. It reads the FOLIO, not the live price: what was agreed,
// what has arrived, what is still owed.
//
// The cases that matter: what it shows, that a PART payment is possible and capped at
// what is still owed, that confirming without payment is offered on a pending booking,
// and who may see any of it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let perms: string[] = [];
const markPaidMutate = vi.fn().mockResolvedValue({});

vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: (p: string) => boolean }) => unknown) =>
    sel({ hasPerm: (p: string) => perms.includes(p) }),
}));

vi.mock('./GuestPicker', () => ({
  GuestPicker: () => <div data-testid="guest-picker" />,
}));

const idle = { mutateAsync: vi.fn(), isPending: false };
const confirmMutate = vi.fn().mockResolvedValue({});

// P1,008.00 stay, P500.00 already received — the owner's own "500 of 1500" shape.
let folioData: Record<string, unknown> | undefined = {
  reservation_id: 'res-w',
  currency: 'BWP',
  total_amount: 100_800,
  paid_amount: 50_000,
  outstanding_amount: 50_800,
  payment_state: 'PART_PAID',
  total_source: 'FOLIO',
  invoices: [],
};

vi.mock('./hooks', () => ({
  useCreateReservation: () => idle,
  useUpdateReservation: () => idle,
  useCancelReservation: () => idle,
  useRemoveReservation: () => idle,
  useSetDiscount: () => idle,
  useApproveDiscount: () => idle,
  useRemoveDiscount: () => idle,
  useClaimOtaBooking: () => idle,
  useMarkPaid: () => ({ mutateAsync: markPaidMutate, isPending: false }),
  useMarkNoShow: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFolio: () => ({ isLoading: false, isError: false, data: folioData, refetch: vi.fn() }),
  useConfirmReservation: () => ({ mutateAsync: confirmMutate, isPending: false }),
  useAvailability: () => ({ data: undefined, isFetching: false }),
  useReservationPricing: () => ({
    isLoading: false,
    data: {
      priceable: true,
      currency: 'BWP',
      nights: 1,
      base_amount: 90_000,
      discount: null,
      subtotal: 90_000,
      tax_rate_bps: 1200,
      tax_amount: 10_800,
      total_amount: 100_800,
      deposit_pct: 0,
      deposit_amount: 0,
    },
  }),
}));

const refundMutate = vi.fn().mockResolvedValue({});
vi.mock('@/features/invoices/hooks', () => ({
  useRefundInvoice: () => ({ mutateAsync: refundMutate, isPending: false }),
}));

import { ReservationFormDrawer } from './ReservationFormDrawer';

const booking = {
  id: 'res-w',
  contact_id: 'c1',
  room_id: 'room-1',
  check_in_date: '2026-08-26',
  check_out_date: '2026-08-27',
  status: 'PENDING',
  source: 'WEBSITE',
  notes: null,
  discount_type: null,
  discount_value: null,
  discount_reason: null,
  discount_approved_at: null,
  created_at: '2026-08-24T10:00:00Z',
  guest_name: 'Tuduetso Mmile',
  room_code: 'B1',
  room_name: 'B Block',
} as never;

const rooms = [{ id: 'room-1', code: 'B1', name: 'B Block', type: 'STANDARD' }] as never;

function open(over: Record<string, unknown> = {}) {
  render(
    <ReservationFormDrawer
      open
      onOpenChange={() => {}}
      reservation={{ ...(booking as object), ...over } as never}
      rooms={rooms}
      canUpdate
      canCancel
    />,
  );
}

describe('ReservationFormDrawer — the money on a booking', () => {
  beforeEach(() => {
    markPaidMutate.mockClear();
    confirmMutate.mockClear();
    perms = ['payments.create', 'payments.update'];
    folioData = {
      reservation_id: 'res-w',
      currency: 'BWP',
      total_amount: 100_800,
      paid_amount: 50_000,
      outstanding_amount: 50_800,
      payment_state: 'PART_PAID',
      total_source: 'FOLIO',
      invoices: [],
    };
  });

  it('says how much of the total has been paid, and what is left', () => {
    open();
    expect(screen.getByText('BWP 500.00 of BWP 1,008.00 paid')).toBeInTheDocument();
    expect(screen.getByText('BWP 508.00 still outstanding')).toBeInTheDocument();
    expect(screen.getByText('part paid')).toBeInTheDocument();
  });

  // (R6) A FULL refund also leaves the agreed total at P0 — refunding lowers it by what went
  // back (owner decision 2026-10-02). That is not a complimentary stay, and saying "there is
  // no invoice" was false: the receipt and its credit note are right there.
  it('says "Fully refunded" — not "Complimentary" — after a full refund', () => {
    folioData = {
      ...folioData!, total_amount: 0, paid_amount: 0, outstanding_amount: 0, payment_state: 'PAID',
      invoices: [
        { id: 'i1', number: 'INV-1', kind: 'BALANCE', status: 'REFUNDED', total_amount: 100_800, created_at: '2026-08-24T10:00:00Z' },
        { id: 'i2', number: 'CN-1', kind: 'REFUND', status: 'PAID', total_amount: 100_800, created_at: '2026-08-25T10:00:00Z' },
      ],
    };
    open();
    expect(screen.getByText(/Fully refunded/)).toBeInTheDocument();
    expect(screen.queryByText(/Complimentary/)).not.toBeInTheDocument();
  });

  // (R8 #2) The words said "Fully refunded" but the badge beside "P0.00 of P0.00" still
  // said "paid". When everything paid has gone back, the badge says so too.
  it('badges a fully refunded booking "fully refunded", not "paid"', () => {
    folioData = {
      ...folioData!, total_amount: 0, paid_amount: 0, outstanding_amount: 0, payment_state: 'PAID',
      invoices: [
        { id: 'i1', number: 'INV-1', kind: 'BALANCE', status: 'REFUNDED', total_amount: 100_800, created_at: '2026-08-24T10:00:00Z' },
        { id: 'i2', number: 'CN-1', kind: 'REFUND', status: 'PAID', total_amount: 100_800, created_at: '2026-08-25T10:00:00Z' },
      ],
    };
    open();
    expect(screen.getByText('fully refunded')).toBeInTheDocument();
    expect(screen.queryByText('paid', { exact: true })).not.toBeInTheDocument();
  });

  // (R8 #3) A cancelled booking still holding money can't be removed — "refund it from the
  // booking first" — but the booking had no way to refund. It does now, from the receipt.
  describe('refunding from the booking', () => {
    const cancelledWithMoney = () => {
      folioData = {
        ...folioData!, total_amount: 50_000, paid_amount: 50_000, outstanding_amount: 0, credit_amount: 0, payment_state: 'PAID',
        invoices: [
          { id: 'rcpt-1', number: 'RCPT-1', kind: 'BALANCE', status: 'PAID', total_amount: 50_000, refunded_amount: 10_000, created_at: '2026-08-24T10:00:00Z' },
        ],
      };
    };
    beforeEach(() => refundMutate.mockClear());

    it('offers a refund on a cancelled booking that still holds money, capped at what is left', async () => {
      perms = ['invoices.refund'];
      cancelledWithMoney();
      open({ status: 'CANCELLED' });
      const amount = screen.getByLabelText('Refund amount (Pula)') as HTMLInputElement;
      expect(amount.value).toBe('400.00'); // P500 receipt, P100 already refunded
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Cancelled within terms' } });
      fireEvent.click(screen.getByRole('button', { name: 'Refund BWP 400.00' }));
      await waitFor(() => expect(refundMutate).toHaveBeenCalledWith({
        id: 'rcpt-1', amount: 40_000, reason: 'Cancelled within terms', idempotencyKey: expect.stringMatching(UUID),
      }));
    });

    it('is not offered without the refund permission', () => {
      perms = ['payments.create', 'payments.update'];
      cancelledWithMoney();
      open({ status: 'CANCELLED' });
      expect(screen.queryByLabelText('Refund amount (Pula)')).not.toBeInTheDocument();
    });

    it('is not offered on a live booking that is simply paid', () => {
      perms = ['invoices.refund'];
      cancelledWithMoney();
      open({ status: 'CONFIRMED' });
      expect(screen.queryByLabelText('Refund amount (Pula)')).not.toBeInTheDocument();
    });
  });

  it('keeps "Complimentary" for a stay that was agreed at P0 and never invoiced', () => {
    folioData = { ...folioData!, total_amount: 0, paid_amount: 0, outstanding_amount: 0, payment_state: 'PAID', invoices: [] };
    open();
    expect(screen.getByText(/Complimentary — no charge/)).toBeInTheDocument();
    expect(screen.queryByText(/Fully refunded/)).not.toBeInTheDocument();
  });

  it('flags a price that was never agreed, so nobody quotes it as a debt', () => {
    folioData = { ...folioData!, total_source: 'PRICED' };
    open();
    expect(screen.getByText(/No price has been agreed on this booking yet/)).toBeInTheDocument();
  });

  it('defaults to the OUTSTANDING amount, not the whole stay', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    // The confirm step names what will actually be taken — P508.00 left, not the
    // P1,008.00 the stay cost. Charging the full total again is the bug this prevents.
    expect(await screen.findByRole('button', { name: 'Yes — record BWP 508.00' })).toBeInTheDocument();
  });

  it('asks for confirmation before taking money, and only then records it', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(markPaidMutate).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /^Yes — record/ }));

    await waitFor(() =>
      expect(markPaidMutate).toHaveBeenCalledWith({
        id: 'res-w',
        input: { method: 'CASH', amount: undefined, reference: null },
        idempotencyKey: expect.stringMatching(UUID),
      }),
    );
  });

  // (R6 item 20) "Yes — record" appeared exactly where "Record payment" had been, so a
  // double click sailed through the confirm step. The spot under the pointer is now Cancel.
  it('a double click on "Record payment" does not record — the confirm step still asks', async () => {
    open();
    const first = screen.getByRole('button', { name: 'Record payment' });
    fireEvent.click(first);
    fireEvent.click(first);
    await new Promise((r) => setTimeout(r, 0));
    expect(markPaidMutate).not.toHaveBeenCalled();
    const row = screen.getByRole('button', { name: /^Yes — record/ }).parentElement!;
    expect(row.querySelector('button')).toHaveTextContent('Cancel');
  });

  it('sends a part payment in thebe, and the method and reference entered', async () => {
    open();
    fireEvent.change(screen.getByLabelText('How much did they pay?'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('How did they pay?'), { target: { value: 'EFT' } });
    fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: 'FNB-9931' } });

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Yes — record/ }));

    await waitFor(() =>
      expect(markPaidMutate).toHaveBeenCalledWith({
        id: 'res-w',
        // P200.00 -> 20 000 thebe. Money never travels as a float (invariant 1).
        input: { method: 'EFT', amount: 20_000, reference: 'FNB-9931' },
        idempotencyKey: expect.stringMatching(UUID),
      }),
    );
  });

  it('refuses to send more than the booking still owes', () => {
    open();
    fireEvent.change(screen.getByLabelText('How much did they pay?'), { target: { value: '900' } });
    expect(screen.getByText('That is more than this booking still owes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  });

  // Round 4 N-2: "10,5" used to become P105.00 — ten times what was typed.
  it('refuses a decimal comma — "10,5" is not P105 — and says how to write it', () => {
    open();
    fireEvent.change(screen.getByLabelText('How much did they pay?'), { target: { value: '10,5' } });
    expect(screen.getByText('Use a dot for decimals, e.g. 10.50')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
    expect(markPaidMutate).not.toHaveBeenCalled();
  });

  it('refuses thousands separators too', () => {
    open();
    fireEvent.change(screen.getByLabelText('How much did they pay?'), { target: { value: '1,250.50' } });
    expect(screen.getByText('Leave out thousands separators, e.g. 1250.50')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  });

  it('accepts a dot decimal again once the comma is fixed', () => {
    open();
    const box = screen.getByLabelText('How much did they pay?');
    fireEvent.change(box, { target: { value: '10,5' } });
    fireEvent.change(box, { target: { value: '10.50' } });
    expect(screen.queryByText('Use a dot for decimals, e.g. 10.50')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
  });

  it('sends the SAME Idempotency-Key when the confirm button is pressed again after a failure', async () => {
    markPaidMutate.mockRejectedValueOnce(new Error('boom'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Yes — record/ }));
    await waitFor(() => expect(markPaidMutate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Yes — record/ }));
    await waitFor(() => expect(markPaidMutate).toHaveBeenCalledTimes(2));
    const [first, second] = markPaidMutate.mock.calls.map((c) => c[0].idempotencyKey);
    expect(first).toMatch(UUID);
    expect(second).toBe(first);
  });

  it('hides the payment form once nothing is outstanding', () => {
    folioData = { ...folioData!, paid_amount: 100_800, outstanding_amount: 0, payment_state: 'PAID' };
    open();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    // The folio itself stays: staff still need to see that it was paid.
    expect(screen.getByText('BWP 1,008.00 of BWP 1,008.00 paid')).toBeInTheDocument();
    expect(screen.getByText('paid')).toBeInTheDocument();
  });

  it('offers confirming without payment on a pending booking, behind a confirm step', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm without payment' }));
    expect(confirmMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Why? (optional, but it helps)'), {
      target: { value: 'Corporate, settles monthly' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yes — confirm, money still owed' }));

    await waitFor(() =>
      expect(confirmMutate).toHaveBeenCalledWith({ id: 'res-w', note: 'Corporate, settles monthly' }),
    );
  });

  it('warns that a website booking expires if it stays unpaid', () => {
    open();
    expect(screen.getByText(/cancelled automatically if they stay unpaid for 24 hours/)).toBeInTheDocument();
  });

  it('hides the payment form from staff who cannot settle a payment, and says who can', () => {
    // Reception holds payments.create but NOT payments.update, so the underlying settle
    // call would 403 — better no button than one that fails halfway.
    perms = ['payments.create'];
    open();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask an admin or Accounts to record a payment/)).toBeInTheDocument();
    // They can still SEE what is owed — that is a reservations.read matter, not a
    // payments one, and reception has to be able to answer "what do I owe?"
    expect(screen.getByText('BWP 500.00 of BWP 1,008.00 paid')).toBeInTheDocument();
  });
});
