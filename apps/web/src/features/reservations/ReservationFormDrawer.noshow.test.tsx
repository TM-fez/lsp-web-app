import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A confirmed guest who never arrived used to have nowhere to go: the booking stayed
// CONFIRMED for ever and its nights kept counting as occupied, including on owner
// statements. These cover when the action may be offered, and that it fires.

let perms: string[] = [];
const noShowMutate = vi.fn().mockResolvedValue({});

vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: (p: string) => boolean }) => unknown) =>
    sel({ hasPerm: (p: string) => perms.includes(p) }),
}));

vi.mock('./GuestPicker', () => ({ GuestPicker: () => <div data-testid="guest-picker" /> }));

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
  useMarkPaid: () => idle,
  useMarkNoShow: () => ({ mutateAsync: noShowMutate, isPending: false }),
  useAvailability: () => ({ data: undefined, isFetching: false }),
  useReservationPricing: () => ({ isLoading: false, data: undefined }),
}));

import { ReservationFormDrawer } from './ReservationFormDrawer';

// Well in the past, so "the arrival day has passed" holds whenever this runs.
const booking = {
  id: 'res-c',
  contact_id: 'c1',
  room_id: 'room-1',
  check_in_date: '2020-03-01',
  check_out_date: '2020-03-04',
  status: 'CONFIRMED',
  source: 'WALK_IN',
  notes: null,
  discount_type: null,
  discount_value: null,
  discount_reason: null,
  discount_approved_at: null,
  created_at: '2020-02-01T10:00:00Z',
  guest_name: 'Charity Chipondeni',
  room_code: 'B2',
  room_name: 'B Block',
} as never;

const rooms = [{ id: 'room-1', code: 'B2', name: 'B Block', type: 'STANDARD' }] as never;

function open(reservation: unknown = booking) {
  render(
    <ReservationFormDrawer
      open
      onOpenChange={() => {}}
      reservation={reservation as never}
      rooms={rooms}
      canUpdate
      canCancel
    />
  );
}

describe('ReservationFormDrawer — no-show', () => {
  beforeEach(() => {
    perms = ['reservations.update'];
    noShowMutate.mockClear();
  });

  it('offers the action once the arrival day has passed', () => {
    open();
    expect(screen.getByText('Mark as no-show')).toBeInTheDocument();
  });

  it('confirms first, then records it', async () => {
    open();
    fireEvent.click(screen.getByText('Mark as no-show'));
    expect(noShowMutate).not.toHaveBeenCalled();          // one click is not enough

    fireEvent.click(screen.getByRole('button', { name: /No-show/ }));
    await waitFor(() => expect(noShowMutate).toHaveBeenCalledWith('res-c'));
  });

  // Marking someone a no-show on the morning they are due is a mistake, not a call —
  // and the server refuses it, so the button must not be there to press.
  it('is hidden for a guest who is not due yet', () => {
    open({ ...(booking as object), check_in_date: '2099-01-01', check_out_date: '2099-01-03' });
    expect(screen.queryByText('Mark as no-show')).not.toBeInTheDocument();
  });

  it('is hidden for a booking that is still pending', () => {
    open({ ...(booking as object), status: 'PENDING' });
    expect(screen.queryByText('Mark as no-show')).not.toBeInTheDocument();
  });
});
