import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { CockpitGuestCard } from '@/types';

vi.mock('./hooks', () => ({
  useCheckIn: () => ({ mutate: vi.fn(), isPending: false }),
  useCheckOut: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { TodayRail } from './TodayRail';

const TODAY = '2026-09-01';

const card = (over: Partial<CockpitGuestCard>): CockpitGuestCard => ({
  reservation_id: 'r1', occupancy_id: null, contact_id: 'c1',
  guest_name: 'Charity Chipondeni', room_id: 'rm1', room_name: 'B Block 2', room_code: 'B2',
  check_in_date: TODAY, check_out_date: '2026-09-03', status: 'CONFIRMED', source: 'WALK_IN',
  ...over,
}) as CockpitGuestCard;

describe('TodayRail', () => {
  // The rail now carries overdue arrivals, so a guest waiting since Saturday must not
  // look identical to one walking in this minute.
  it('marks how late an arrival is, and leaves today’s unmarked', () => {
    render(
      <TodayRail
        today={TODAY}
        arrivals={[
          card({ reservation_id: 'late', check_in_date: '2026-08-30' }),
          card({ reservation_id: 'ontime', guest_name: 'Neo Kgosi', check_in_date: TODAY }),
        ]}
        inHouse={[]}
        departures={[]}
      />
    );

    expect(screen.getByText('2 days late')).toBeInTheDocument();
    expect(screen.getAllByText(/days? late/)).toHaveLength(1); // today's arrival carries none
  });

  it('says “1 day late”, not “1 days late”', () => {
    render(
      <TodayRail
        today={TODAY}
        arrivals={[card({ check_in_date: '2026-08-31' })]}
        inHouse={[]}
        departures={[]}
      />
    );
    expect(screen.getByText('1 day late')).toBeInTheDocument();
  });

  // An overstay is the mirror case: still in the unit after their check-out date.
  it('marks an overstaying departure and still offers Check out', () => {
    render(
      <TodayRail
        today={TODAY}
        arrivals={[]}
        inHouse={[]}
        departures={[
          card({ occupancy_id: 'occ1', status: 'CHECKED_IN', check_out_date: '2026-08-29' }),
        ]}
      />
    );
    expect(screen.getByText('3 days late')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check out' })).toBeInTheDocument();
  });

  // node-pg serializes date columns as ISO timestamps. The old slice(5) printed
  // "08-21T00:00:00.000Z" on the live board.
  it('does not leak an ISO timestamp into the stay dates', () => {
    render(
      <TodayRail
        today={TODAY}
        arrivals={[
          card({
            check_in_date: '2026-08-21T00:00:00.000Z',
            check_out_date: '2026-09-06T00:00:00.000Z',
          }),
        ]}
        inHouse={[]}
        departures={[]}
      />
    );
    expect(screen.getByText(/B2 · 08-21 → 09-06/)).toBeInTheDocument();
    expect(screen.queryByText(/T00:00:00/)).not.toBeInTheDocument();
  });
});
