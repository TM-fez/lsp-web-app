import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// (Calendar) Tapping an empty square on the board opens a new booking with that unit and
// that night already filled in — and an edit is never overwritten by it.

vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: (p: string) => boolean }) => unknown) => sel({ hasPerm: () => true }),
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
  useMarkNoShow: () => idle,
  useAvailability: () => ({ data: undefined, isFetching: false }),
  useReservationPricing: () => ({ isLoading: false, data: undefined }),
  useFolio: () => ({ isLoading: false, isError: false, data: undefined, refetch: vi.fn() }),
  useConfirmReservation: () => idle,
}));

import { ReservationFormDrawer } from './ReservationFormDrawer';

const rooms = [
  { id: 'room-1', code: 'B1', name: 'B1', type: 'STANDARD', status: 'AVAILABLE' },
  { id: 'room-2', code: 'B2', name: 'B2', type: 'STANDARD', status: 'AVAILABLE' },
] as never;

describe('ReservationFormDrawer — started from the calendar', () => {
  it('fills in the unit and the night that was tapped', () => {
    const initial = { room_id: 'room-2', check_in_date: '2036-10-07', check_out_date: '2036-10-08' };
    render(
      <ReservationFormDrawer open onOpenChange={() => {}} reservation={null} rooms={rooms} initial={initial} />
    );
    const dates = Array.from(document.body.querySelectorAll('input[type="date"]')).map((i) => (i as HTMLInputElement).value);
    expect(dates).toEqual(['2036-10-07', '2036-10-08']);
    const unit = screen.getByDisplayValue(/B2/) as HTMLSelectElement;
    expect(unit.value).toBe('room-2');
  });

  it('starts blank without it, as before', () => {
    render(<ReservationFormDrawer open onOpenChange={() => {}} reservation={null} rooms={rooms} />);
    const dates = Array.from(document.body.querySelectorAll('input[type="date"]')).map((i) => (i as HTMLInputElement).value);
    expect(dates).toEqual(['', '']);
  });
});
