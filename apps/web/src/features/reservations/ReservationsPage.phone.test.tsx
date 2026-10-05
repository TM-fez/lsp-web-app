import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// (R6 #12) On a phone each row's unit/date line was one truncated line, cut with "…"
// before the dates. The dates now have their own unbroken line, outside the truncation.

vi.mock('./ReservationFormDrawer', () => ({ ReservationFormDrawer: () => null }));
vi.mock('@/features/rooms/hooks', () => ({ useRooms: () => ({ data: [] }) }));
vi.mock('./hooks', () => ({
  useReservations: () => ({
    data: {
      data: [{
        id: 'r1', guest_name: 'Reneilwe Motswasele', room_code: 'DEMO-B4', room_name: 'B4 [DEMO] Village Block B',
        check_in_date: '2026-08-29', check_out_date: '2026-09-02', status: 'CONFIRMED', source: 'WALK_IN',
      }],
      total: 1, page: 1, limit: 100,
    },
    isLoading: false, isError: false, isFetching: false, refetch: () => {},
  }),
}));
vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: () => boolean }) => unknown) => sel({ hasPerm: () => true }),
}));

import { ReservationsPage } from './ReservationsPage';

describe('ReservationsPage row on a phone', () => {
  it('puts the dates on their own line that is never cut off', () => {
    render(<ReservationsPage />);
    const dates = screen.getByTestId('reservation-dates');
    expect(dates.textContent).toMatch(/→/);
    expect(dates.className).toMatch(/whitespace-nowrap/);
    expect(dates.className).toMatch(/(^|\s)block(\s|$)/);
    // Nothing between the dates and the row may truncate on a phone (sm: only).
    expect(dates.parentElement!.className).not.toMatch(/(^|\s)truncate(\s|$)/);
  });
});
