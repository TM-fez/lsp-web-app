import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CalendarView } from '@/types';

const cal = vi.hoisted(() => ({
  value: { data: undefined as unknown, isLoading: false, isError: false, isFetching: false, refetch: () => {} },
  calls: [] as [string, number][],
}));
vi.mock('./hooks', () => ({
  useCalendar: (from: string, days: number) => {
    cal.calls.push([from, days]);
    return cal.value;
  },
}));
vi.mock('@/lib/utils/date', () => ({ todayISO: () => '2026-10-05' }));
vi.mock('@/features/reservations/hooks', () => ({
  useReservation: (id: string) => ({ data: { id, status: 'CONFIRMED', room_id: 'b1' } }),
  useReservations: () => ({ data: { data: [] }, isLoading: false }),
}));
vi.mock('@/features/rooms/hooks', () => ({ useRooms: () => ({ data: [] }) }));
const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: (p: string) => boolean }) => unknown) => sel({ hasPerm: (p) => perms.set.has(p) }),
}));
vi.mock('@/features/reservations/ReservationFormDrawer', () => ({
  ReservationFormDrawer: ({ reservation, initial }: { reservation: { id: string; guest_name?: string } | null; initial?: { room_id?: string; check_in_date?: string; check_out_date?: string } }) =>
    reservation ? (
      <div role="dialog">Booking {reservation.id} for {reservation.guest_name}</div>
    ) : (
      <div role="dialog">New booking {initial?.room_id ?? 'any'} {initial?.check_in_date ?? ''} {initial?.check_out_date ?? ''}</div>
    ),
}));

import { CalendarPage } from './CalendarPage';

const view = (over: Partial<CalendarView> = {}): CalendarView => ({
  from: '2026-10-05', to: '2026-11-02', today: '2026-10-05',
  units: [
    { id: 'b1', code: 'B1', name: 'B1', type: 'STANDARD', status: 'AVAILABLE', building_name: 'Block B' },
    { id: 'b2', code: 'B2', name: 'B2', type: 'STANDARD', status: 'AVAILABLE', building_name: 'Block B' },
    { id: 's1', code: 'S1', name: 'S1', type: 'SUITE', status: 'OUT_OF_SERVICE', building_name: null },
  ],
  bookings: [
    { id: 'r1', room_id: 'b1', check_in_date: '2026-09-28', check_out_date: '2026-11-15', status: 'CHECKED_IN', source: 'CORPORATE',
      guest_name: 'Alexander Forbes', company_name: 'Financial Services Botswana', payment_incomplete: false },
    { id: 'r2', room_id: 'b2', check_in_date: '2026-10-25', check_out_date: '2026-10-27', status: 'CONFIRMED', source: 'DIRECT',
      guest_name: 'Garth Miller', company_name: null, payment_incomplete: true },
  ],
  closures: [
    { room_id: 's1', kind: 'OUT_OF_SERVICE', from: null, to: null, label: 'Closed — out of service', ref_id: null },
  ],
  ...over,
});

const renderPage = () => render(<MemoryRouter><CalendarPage /></MemoryRouter>);

beforeEach(() => {
  cal.calls = [];
  perms.set = new Set(['reservations.read', 'reservations.create', 'reservations.update', 'maintenance.create', 'maintenance.read']);
  cal.value = { data: view(), isLoading: false, isError: false, isFetching: false, refetch: () => {} };
});

describe('CalendarPage', () => {
  it('lays out units by type with LH’s day headers, today marked', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Standard/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Suite/ })).toBeInTheDocument();
    expect(screen.getByText('TODAY')).toBeInTheDocument();
    expect(cal.calls.at(-1)).toEqual(['2026-10-05', 28]);
    expect(screen.getByTestId('unit-row-B1')).toBeInTheDocument();
  });

  it('draws each stay as "Company, Guest" with the incomplete-payment corner, and closures in words', () => {
    renderPage();
    const b1 = within(screen.getByTestId('unit-row-B1'));
    expect(b1.getByText('Financial Services Botswana, Alexander Forbes')).toBeInTheDocument();
    expect(b1.queryByLabelText('Payment incomplete')).toBeNull();
    const b2 = within(screen.getByTestId('unit-row-B2'));
    expect(b2.getByText('Garth Miller')).toBeInTheDocument();
    expect(b2.getByLabelText('Payment incomplete')).toBeInTheDocument();
    expect(within(screen.getByTestId('unit-row-S1')).getByText('Closed — out of service')).toBeInTheDocument();
    expect(screen.getByText('Incomplete payment')).toBeInTheDocument();
  });

  it('opens the booking when its bar is tapped', () => {
    renderPage();
    fireEvent.click(screen.getByText('Garth Miller'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Booking r2 for Garth Miller');
  });

  it('starts a one-night booking on that unit when an empty square is tapped — never in the past', () => {
    renderPage();
    const squares = screen.getAllByRole('button', { name: /New booking: B2 from/ });
    // Today plus 27 more nights — every square on screen is today or later.
    expect(squares).toHaveLength(28);
    fireEvent.click(squares[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('New booking b2 2026-10-05 2026-10-06');
  });

  it('does not offer squares before today when paging back', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Back a week' }));
    // 28 nights from 28 Sep: the 7 before today are not offered.
    expect(screen.getAllByRole('button', { name: /New booking: B2 from/ })).toHaveLength(21);
  });

  it('pages a day, a week and the whole view, and comes back to today', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Forward a day' }));
    expect(cal.calls.at(-1)).toEqual(['2026-10-06', 28]);
    fireEvent.click(screen.getByRole('button', { name: 'Forward a week' }));
    expect(cal.calls.at(-1)).toEqual(['2026-10-13', 28]);
    fireEvent.click(screen.getByRole('button', { name: 'Back 28 days' }));
    expect(cal.calls.at(-1)).toEqual(['2026-09-15', 28]);
    fireEvent.change(screen.getByLabelText('Nights shown'), { target: { value: '7' } });
    expect(cal.calls.at(-1)).toEqual(['2026-09-15', 7]);
    fireEvent.click(screen.getByRole('button', { name: 'View today' }));
    expect(cal.calls.at(-1)).toEqual(['2026-10-05', 7]);
  });

  it('collapses a unit type like LH', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Standard/ }));
    expect(screen.queryByTestId('unit-row-B1')).toBeNull();
    expect(screen.getByTestId('unit-row-S1')).toBeInTheDocument();
  });

  it('offers no new-booking squares or buttons to someone who can only look', () => {
    perms.set = new Set(['reservations.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /New booking:/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reservation/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Room closure/ })).toBeNull();
  });

  it('says why the board is empty, and retries when it could not load', () => {
    cal.value = { ...cal.value, data: view({ units: [], bookings: [], closures: [] }) };
    const { unmount } = renderPage();
    expect(screen.getByText('No units in this property yet')).toBeInTheDocument();
    unmount();
    const refetch = vi.fn();
    cal.value = { data: undefined, isLoading: false, isError: true, isFetching: false, refetch };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });
});
