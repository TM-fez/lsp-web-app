import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Recording a payment is the only route from a pending booking to a confirmed one —
// a website booking arrives with no hold behind it, so without this panel it can only
// expire. These cover the two things that matter: who may see it, and what it sends.

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

describe('ReservationFormDrawer — recording a payment', () => {
  beforeEach(() => {
    markPaidMutate.mockClear();
    perms = ['payments.create', 'payments.update'];
  });

  it('shows the amount due and a plain-language button', () => {
    open();
    expect(screen.getByRole('button', { name: 'Guest has paid' })).toBeInTheDocument();
    expect(screen.getByText('Amount due')).toBeInTheDocument();
  });

  it('warns that a website booking expires if it stays unpaid', () => {
    open();
    expect(screen.getByText(/cancelled automatically if they stay unpaid for 24 hours/)).toBeInTheDocument();
  });

  it('asks for confirmation before taking money, and only then records it', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Guest has paid' }));
    expect(markPaidMutate).not.toHaveBeenCalled();

    const confirm = await screen.findByRole('button', { name: /^Yes — record/ });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(markPaidMutate).toHaveBeenCalledWith({
        id: 'res-w',
        input: { method: 'CASH', reference: null },
      }),
    );
  });

  it('sends the method and reference the user actually entered', async () => {
    open();
    fireEvent.change(screen.getByLabelText('How did they pay?'), { target: { value: 'EFT' } });
    fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: 'FNB-9931' } });

    fireEvent.click(screen.getByRole('button', { name: 'Guest has paid' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Yes — record/ }));

    await waitFor(() =>
      expect(markPaidMutate).toHaveBeenCalledWith({
        id: 'res-w',
        input: { method: 'EFT', reference: 'FNB-9931' },
      }),
    );
  });

  it('hides the panel from staff who cannot settle a payment, and says who can', () => {
    // Reception holds payments.create but NOT payments.update, so the underlying
    // settle call would 403 — better no button than one that fails halfway.
    perms = ['payments.create'];
    open();
    expect(screen.queryByRole('button', { name: 'Guest has paid' })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask an admin or Accounts to record the payment/)).toBeInTheDocument();
  });
});
