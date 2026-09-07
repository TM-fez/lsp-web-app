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

function open() {
  render(
    <ReservationFormDrawer
      open
      onOpenChange={() => {}}
      reservation={booking}
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
      }),
    );
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
      }),
    );
  });

  it('refuses to send more than the booking still owes', () => {
    open();
    fireEvent.change(screen.getByLabelText('How much did they pay?'), { target: { value: '900' } });
    expect(screen.getByText('That is more than this booking still owes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
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
