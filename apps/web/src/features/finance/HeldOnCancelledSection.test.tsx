import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const state = vi.hoisted(() => ({
  value: { data: undefined as unknown, isLoading: false, isError: false },
}));
vi.mock('./hooks', () => ({ useHeldOnCancelled: () => state.value }));
const booking = vi.hoisted(() => ({ id: undefined as string | undefined }));
vi.mock('@/features/reservations/hooks', () => ({
  useReservation: (id: string | undefined) => {
    booking.id = id;
    return { data: id ? { id, status: 'CANCELLED', room_id: 'room-1' } : undefined, isLoading: false };
  },
}));
vi.mock('@/features/rooms/hooks', () => ({ useRooms: () => ({ data: [] }) }));
vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: () => boolean }) => unknown) => sel({ hasPerm: () => true }),
}));
vi.mock('@/features/reservations/ReservationFormDrawer', () => ({
  ReservationFormDrawer: ({ open, reservation }: { open: boolean; reservation: { id: string; guest_name?: string } | null }) =>
    open && reservation ? <div role="dialog">Booking {reservation.id} for {reservation.guest_name}</div> : null,
}));

import { HeldOnCancelledSection } from './HeldOnCancelledSection';

const row = (over: object = {}) => ({
  reservation_id: 'r1', guest_name: 'Neo Kgosi', room_code: 'V-101', status: 'CANCELLED',
  check_in_date: '2026-09-01', check_out_date: '2026-09-03', currency: 'BWP', received: 300_050, cancelled_on: '2026-08-20', ...over,
});

describe('HeldOnCancelledSection', () => {
  it('lists each cancelled booking with the money it still holds, and says nothing is refunded automatically', () => {
    state.value = {
      data: { as_of: '', count: 2, total_held: 420_050, note: 'Nothing is refunded automatically.', rows: [row(), row({ reservation_id: 'r2', guest_name: 'Amo', status: 'NO_SHOW', received: 120_000 })] },
      isLoading: false, isError: false,
    };

    render(<HeldOnCancelledSection />);

    expect(screen.getByRole('heading', { name: 'Cancelled with money held' })).toBeInTheDocument();
    expect(screen.getByText('Neo Kgosi')).toBeInTheDocument();
    expect(screen.getByText('P3,000.50')).toBeInTheDocument();
    expect(screen.getByText('No-show')).toBeInTheDocument();
    expect(screen.getByText(/2 bookings · P4,200.50 held/)).toHaveTextContent('Nothing is refunded automatically.');
  });

  it('says so plainly when nothing is held', () => {
    state.value = { data: { as_of: '', count: 0, total_held: 0, note: '', rows: [] }, isLoading: false, isError: false };

    render(<HeldOnCancelledSection />);

    expect(screen.getByText('No cancelled bookings are holding guest money.')).toBeInTheDocument();
  });

  it('does not pretend all is well when it cannot load', () => {
    state.value = { data: undefined, isLoading: false, isError: true };

    render(<HeldOnCancelledSection />);

    expect(screen.getByText(/Couldn’t load cancelled bookings/)).toBeInTheDocument();
  });

  // (R9 #3) The list showed the bookings but they did not open — staff had to find each one
  // again under Reservations, where the refund lives. A row now opens its booking here.
  it('opens the booking when a row is clicked', () => {
    state.value = {
      data: { as_of: '', count: 1, total_held: 300_050, note: '', rows: [row()] },
      isLoading: false, isError: false,
    };
    render(<HeldOnCancelledSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Neo Kgosi' }));
    expect(booking.id).toBe('r1');
    expect(screen.getByRole('dialog')).toHaveTextContent('Booking r1 for Neo Kgosi');
  });
});

