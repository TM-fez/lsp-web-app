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
    beforeEach(() => refundMutate.mockClear().mockResolvedValue({}));

    // (R10 #2) Empty on a cancelled booking too — a prefilled full amount was one click from
    // refunding all of it. The limit is said above the box. No "makes the stay free" question:
    // a cancelled stay is already off.
    it('offers a refund on a cancelled booking that still holds money, starting empty, capped at what is left', async () => {
      perms = ['invoices.refund'];
      cancelledWithMoney();
      open({ status: 'CANCELLED' });
      const amount = screen.getByLabelText('Refund amount (Pula)') as HTMLInputElement;
      expect(amount.value).toBe('');
      expect(screen.getByText(/Up to BWP 400.00 can go back from here/)).toBeInTheDocument(); // P500 receipt, P100 already refunded
      fireEvent.change(amount, { target: { value: '400' } });
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Cancelled within terms' } });
      fireEvent.click(screen.getByRole('button', { name: 'Refund BWP 400.00' }));
      await waitFor(() => expect(refundMutate).toHaveBeenCalledWith({
        id: 'rcpt-1', amount: 40_000, reason: 'Cancelled within terms', idempotencyKey: expect.stringMatching(UUID), confirmFullRefund: false,
      }));
    });

    // (R10 #1) Refunding a live stay down to P0 makes it free while the guest keeps the unit.
    it('asks before a refund that would make a live stay free, and only "Yes" sends it', async () => {
      perms = ['invoices.refund'];
      folioData = {
        ...folioData!, total_amount: 50_000, paid_amount: 50_000, outstanding_amount: 0, credit_amount: 0, payment_state: 'PAID',
        invoices: [{ id: 'rcpt-1', number: 'RCPT-1', kind: 'BALANCE', status: 'PAID', total_amount: 50_000, refunded_amount: 0, created_at: '2026-08-24T10:00:00Z' }],
      };
      open({ status: 'CONFIRMED' });
      fireEvent.change(screen.getByLabelText('Refund amount (Pula)'), { target: { value: '500' } });
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Guest asked' } });
      fireEvent.click(screen.getByRole('button', { name: 'Refund BWP 500.00' }));
      expect(screen.getByRole('alert')).toHaveTextContent(/makes the stay free — the guest keeps the unit/);
      expect(refundMutate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Yes — refund BWP 500.00' }));
      await waitFor(() => expect(refundMutate).toHaveBeenCalledWith(expect.objectContaining({ amount: 50_000, confirmFullRefund: true })));
    });

    it('shows the server’s question when it asks (its figures may be newer than the screen’s)', async () => {
      perms = ['invoices.refund'];
      cancelledWithMoney();
      refundMutate.mockRejectedValueOnce({ response: { status: 409, data: { error: 'Full Refund', message: 'This refunds everything and makes the stay free.' } } });
      open({ status: 'CONFIRMED' });
      fireEvent.change(screen.getByLabelText('Refund amount (Pula)'), { target: { value: '100' } });
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'x' } });
      fireEvent.click(screen.getByRole('button', { name: 'Refund BWP 100.00' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('This refunds everything and makes the stay free.');
    });

    // (R10 #4) A stay shortened after payment can only hand back the overpayment — the server
    // refuses more. The drawer said "Up to P2,223" while the server allowed P741.
    it('caps a shortened stay at what was overpaid, not at the receipt', () => {
      perms = ['invoices.refund'];
      folioData = {
        ...folioData!, total_amount: 148_200, paid_amount: 222_300, outstanding_amount: 0, credit_amount: 74_100, payment_state: 'PAID',
        invoices: [{ id: 'rcpt-1', number: 'RCPT-1', kind: 'BALANCE', status: 'PAID', total_amount: 222_300, refunded_amount: 0, created_at: '2026-08-24T10:00:00Z' }],
      };
      open({ status: 'CONFIRMED' });
      expect(screen.getByText(/Up to BWP 741.00 can go back from here — what was paid beyond the shortened stay/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Refund amount (Pula)'), { target: { value: '741.01' } });
      expect(screen.getByText('That is more than can be refunded from here.')).toBeInTheDocument();
      // …and handing back exactly the overpayment does not make the stay free, so no question.
      fireEvent.change(screen.getByLabelText('Refund amount (Pula)'), { target: { value: '741' } });
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Stay shortened' } });
      fireEvent.click(screen.getByRole('button', { name: 'Refund BWP 741.00' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('is not offered without the refund permission', () => {
      perms = ['payments.create', 'payments.update'];
      cancelledWithMoney();
      open({ status: 'CANCELLED' });
      expect(screen.queryByLabelText('Refund amount (Pula)')).not.toBeInTheDocument();
    });

    // (R9 #4) A normal confirmed, paid stay could only be refunded from Finance → Invoices.
    // It is offered here too — empty, so nobody refunds the whole stay by accident.
    it('is offered on a live, paid booking too, starting empty', async () => {
      perms = ['invoices.refund'];
      cancelledWithMoney();
      open({ status: 'CONFIRMED' });
      const amount = screen.getByLabelText('Refund amount (Pula)') as HTMLInputElement;
      expect(amount.value).toBe('');
      expect(screen.getByText(/Up to BWP 400.00 can go back from here/)).toBeInTheDocument();
      fireEvent.change(amount, { target: { value: '50' } });
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Goodwill' } });
      fireEvent.click(screen.getByRole('button', { name: 'Refund BWP 50.00' }));
      await waitFor(() => expect(refundMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'rcpt-1', amount: 5_000 })));
    });

    it('is not offered when nothing has been paid', () => {
      perms = ['invoices.refund'];
      folioData = { ...folioData!, paid_amount: 0, invoices: [] };
      open({ status: 'CONFIRMED' });
      expect(screen.queryByLabelText('Refund amount (Pula)')).not.toBeInTheDocument();
    });
  });

  // (R10 #3) "P1,723 of P1,723 paid" after a P500 refund — true, but silent about the refund.
  it('shows what has been refunded on a part-refunded booking', () => {
    folioData = {
      ...folioData!, total_amount: 172_300, paid_amount: 172_300, outstanding_amount: 0, credit_amount: 0, payment_state: 'PAID',
      invoices: [
        { id: 'i1', number: 'INV-1', kind: 'BALANCE', status: 'PAID', total_amount: 222_300, refunded_amount: 50_000, created_at: '2026-08-24T10:00:00Z' },
        { id: 'i2', number: 'CN-1', kind: 'REFUND', status: 'PAID', total_amount: 50_000, created_at: '2026-08-25T10:00:00Z' },
      ],
    };
    open({ status: 'CONFIRMED' });
    expect(screen.getByText('BWP 1,723.00 of BWP 1,723.00 paid')).toBeInTheDocument();
    expect(screen.getByText('BWP 500.00 refunded')).toBeInTheDocument();
  });

  // (R10 #5, #6) Once confirmed, "Deposit to confirm" is advice for a step already done; and a
  // section that can no longer take a discount is headed "Price", not "Discount".
  it('shows "Deposit to confirm" and "Price & discount" only while the booking is pending', () => {
    perms = ['reservations.discount.request'];
    open({ status: 'PENDING' });
    expect(screen.getByText(/Deposit to confirm/)).toBeInTheDocument();
    expect(screen.getByText('Price & discount')).toBeInTheDocument();
  });

  it('hides "Deposit to confirm" and heads the box "Price" on a confirmed booking with no discount', () => {
    perms = ['reservations.discount.request'];
    open({ status: 'CONFIRMED' });
    expect(screen.queryByText(/Deposit to confirm/)).not.toBeInTheDocument();
    expect(screen.queryByText('Price & discount')).not.toBeInTheDocument();
    expect(screen.getByText('Price', { exact: true })).toBeInTheDocument();
  });

  // (Round 11) "P3,249 of P2,166 paid" beside a "paid" badge read oddly.
  it('shows an overpaid stay as paid against agreed, badged overpaid', () => {
    folioData = {
      ...folioData!, total_amount: 216_600, paid_amount: 324_900, outstanding_amount: 0, credit_amount: 108_300, payment_state: 'PAID',
      invoices: [{ id: 'rcpt-1', number: 'RCPT-1', kind: 'BALANCE', status: 'PAID', total_amount: 324_900, refunded_amount: 0, created_at: '2026-08-24T10:00:00Z' }],
    };
    open({ status: 'CONFIRMED' });
    expect(screen.getByText('BWP 3,249.00 paid — agreed BWP 2,166.00')).toBeInTheDocument();
    expect(screen.queryByText(/of BWP 2,166.00 paid/)).not.toBeInTheDocument();
    expect(screen.getByText('overpaid')).toBeInTheDocument();
    expect(screen.queryByText('paid', { exact: true })).not.toBeInTheDocument();
  });

  // (R10 #6) Text still sent staff to the Invoices page, which the booking can now do itself.
  it('points to the refund on this booking, not the Invoices page', () => {
    perms = ['invoices.refund'];
    folioData = {
      ...folioData!, total_amount: 148_200, paid_amount: 222_300, outstanding_amount: 0, credit_amount: 74_100, payment_state: 'PAID',
      invoices: [{ id: 'rcpt-1', number: 'RCPT-1', kind: 'BALANCE', status: 'PAID', total_amount: 222_300, refunded_amount: 0, created_at: '2026-08-24T10:00:00Z' }],
    };
    open({ status: 'CONFIRMED' });
    expect(screen.getByText(/refund due — the guest has paid more than the agreed price\. Refund it below\./)).toBeInTheDocument();
    expect(screen.queryByText(/Invoices page/)).not.toBeInTheDocument();
  });

  // (R9 #5) "Fully refunded · P0 of P0 paid" sat beside a price box still calling today's
  // price for the stay "Total due". Once a total is agreed, the box shows that agreed total
  // (P0 after a full refund) and labels today's price as what it is.
  it('does not call today’s price "Total due" once a total is agreed — a full refund reads P0', () => {
    perms = ['payments.create', 'payments.update', 'reservations.discount.request'];
    folioData = {
      ...folioData!, total_amount: 0, paid_amount: 0, outstanding_amount: 0, payment_state: 'REFUNDED',
      invoices: [
        { id: 'i1', number: 'INV-1', kind: 'BALANCE', status: 'REFUNDED', total_amount: 100_800, created_at: '2026-08-24T10:00:00Z' },
        { id: 'i2', number: 'CN-1', kind: 'REFUND', status: 'PAID', total_amount: 100_800, created_at: '2026-08-25T10:00:00Z' },
      ],
    };
    open({ status: 'CONFIRMED' });
    expect(screen.queryByText('Total due')).not.toBeInTheDocument();
    expect(screen.getByText('Agreed total (after refunds)').parentElement).toHaveTextContent('BWP 0.00');
    expect(screen.getByText('Price at today’s rates').parentElement).toHaveTextContent('BWP 1,008.00');
  });

  it('still says "Total due" while no total has been agreed yet', () => {
    perms = ['payments.create', 'payments.update', 'reservations.discount.request'];
    folioData = { ...folioData!, total_source: 'PRICED' };
    open();
    expect(screen.getByText('Total due').parentElement).toHaveTextContent('BWP 1,008.00');
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
