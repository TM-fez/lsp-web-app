import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The discount control. The server only takes a discount on a PENDING booking (409 "A
// discount can only be applied to a pending booking…"), so the form is offered only then —
// a confirmed booking gets the reason in words. And when a request IS refused, the reason
// shows IN the drawer (not just in a toast that fades), because the price did not change.

let perms: string[] = [];
const setDiscountMutate = vi.fn();
const approveMutate = vi.fn();
const removeMutate = vi.fn();

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
  useSetDiscount: () => ({ mutate: setDiscountMutate, isPending: false }),
  useApproveDiscount: () => ({ mutate: approveMutate, isPending: false }),
  useRemoveDiscount: () => ({ mutate: removeMutate, isPending: false }),
  useClaimOtaBooking: () => idle,
  useMarkPaid: () => idle,
  useMarkNoShow: () => idle,
  useAvailability: () => ({ data: undefined, isFetching: false }),
  useReservationPricing: () => ({ isLoading: false, data: undefined }),
  useFolio: () => ({ isLoading: false, isError: false, data: undefined, refetch: vi.fn() }),
  useConfirmReservation: () => idle,
}));

import { ReservationFormDrawer } from './ReservationFormDrawer';

const base = {
  id: 'res-d', contact_id: 'c1', room_id: 'room-1', check_in_date: '2030-08-26', check_out_date: '2030-08-27',
  status: 'PENDING', source: 'WALK_IN', notes: null, discount_type: null, discount_value: null, discount_reason: null,
  discount_approved_at: null, created_at: '2030-08-24T10:00:00Z', guest_name: 'Neo Kgosi', room_code: 'B1', room_name: 'B Block',
};
const rooms = [{ id: 'room-1', code: 'B1', name: 'B Block', type: 'STANDARD' }] as never;

function open(over: Record<string, unknown> = {}) {
  render(<ReservationFormDrawer open onOpenChange={() => {}} reservation={{ ...base, ...over } as never} rooms={rooms} canUpdate canCancel />);
}
const percentBox = () => screen.getByLabelText('Discount percentage');

describe('ReservationFormDrawer — discount control', () => {
  beforeEach(() => {
    setDiscountMutate.mockReset();
    approveMutate.mockReset();
    removeMutate.mockReset();
    perms = ['reservations.discount.request'];
  });

  it('offers the discount form on a PENDING booking', () => {
    open();
    expect(percentBox()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request discount' })).toBeInTheDocument();
  });

  it('hides the form on a CONFIRMED booking and explains why', () => {
    open({ status: 'CONFIRMED' });
    expect(screen.queryByLabelText('Discount percentage')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request discount' })).not.toBeInTheDocument();
    expect(screen.getByText(/A discount can only be added while the booking is pending, before payment confirms it/)).toBeInTheDocument();
  });

  it('still shows an already-applied discount on a confirmed booking (with Remove)', () => {
    open({ status: 'CONFIRMED', discount_type: 'PERCENT', discount_value: 10, discount_approved_at: '2030-08-25T00:00:00Z' });
    expect(screen.getByText('10% off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('sends a whole percent', () => {
    open();
    fireEvent.change(percentBox(), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request discount' }));
    expect(setDiscountMutate).toHaveBeenCalledWith(
      { id: 'res-d', input: { discount_type: 'PERCENT', discount_value: 15, discount_reason: null } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('sends a fixed amount in thebe, and refuses a decimal comma', () => {
    open();
    fireEvent.change(screen.getByDisplayValue('Percent %'), { target: { value: 'FIXED' } });
    const box = screen.getByLabelText('Discount amount in pula');
    fireEvent.change(box, { target: { value: '200,5' } });
    expect(screen.getByText('Use a dot for decimals, e.g. 10.50')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request discount' })).toBeDisabled();

    fireEvent.change(box, { target: { value: '200.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request discount' }));
    expect(setDiscountMutate.mock.calls[0]![0].input).toMatchObject({ discount_type: 'FIXED', discount_value: 20_050 });
  });

  it('refuses a percent outside 1–100 or with decimals', () => {
    open();
    for (const bad of ['0', '101', '12.5']) {
      fireEvent.change(percentBox(), { target: { value: bad } });
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Request discount' })).toBeDisabled();
    }
  });

  it('shows the server’s refusal inside the drawer when the discount request fails', async () => {
    setDiscountMutate.mockImplementation((_vars, opts) =>
      opts.onError({ isAxiosError: true, response: { data: { message: 'A discount can only be applied to a pending booking (before payment confirms it)' } } }),
    );
    open();
    fireEvent.change(percentBox(), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request discount' }));
    expect(await screen.findByText('A discount can only be applied to a pending booking (before payment confirms it)')).toBeInTheDocument();
    // …and typing again clears the stale message.
    fireEvent.change(percentBox(), { target: { value: '11' } });
    await waitFor(() => expect(screen.queryByText(/can only be applied to a pending booking/)).not.toBeInTheDocument());
  });

  it('shows the refusal when removing or approving a discount fails too', async () => {
    perms = ['reservations.discount.request', 'reservations.discount.approve'];
    removeMutate.mockImplementation((_id, opts) => opts.onError({ isAxiosError: true, response: { data: { message: 'Could not remove the discount' } } }));
    approveMutate.mockImplementation((_id, opts) => opts.onError({ isAxiosError: true, response: { data: { message: 'This discount has already been approved' } } }));
    open({ discount_type: 'PERCENT', discount_value: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Could not remove the discount')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('This discount has already been approved')).toBeInTheDocument();
  });
});
