import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

// Guests carried over from Little Hotelier arrive with a stay COUNT and no bookings in LSP,
// so the badge is the only place that history is visible on the list.
const guest = (over: Partial<Record<string, unknown>>) => ({
  id: '1', type: 'individual', name: 'Shinichiro Wada', email: null, phone: '71344195',
  company: null, address: null, notes: null, previous_stays: 0,
  created_at: '2026-08-19T00:00:00Z', updated_at: '2026-08-19T00:00:00Z', ...over,
});

const rows = [
  guest({ id: '1', name: 'Shinichiro Wada', previous_stays: 31 }),
  guest({ id: '2', name: 'Once Only', previous_stays: 1 }),
  guest({ id: '3', name: 'Booked Here First', previous_stays: 0 }),
];

vi.mock('./hooks', () => ({
  useGuests: () => ({
    data: { data: rows, total: rows.length, page: 1, pageSize: 100 },
    isLoading: false, isError: false, isFetching: false, refetch: () => {},
  }),
  useDeleteGuest: () => ({ mutateAsync: async () => {}, isPending: false }),
  useCreateGuest: () => ({ mutateAsync: async () => {}, isPending: false }),
  useUpdateGuest: () => ({ mutateAsync: async () => {}, isPending: false }),
}));

vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: () => boolean }) => unknown) => sel({ hasPerm: () => true }),
}));

// The segment filter hands off to the marketing member list, so one definition of "VIP"
// serves both screens.
vi.mock('@/features/marketing/SegmentMembers', () => ({
  SegmentMembers: ({ label }: { label: string }) => <div>segment list: {label}</div>,
}));

import { GuestsPage } from './GuestsPage';

describe('GuestsPage', () => {
  it('shows carried-over stay history, pluralised, and only where there is any', () => {
    render(<GuestsPage />);
    expect(screen.getByText('31 previous stays')).toBeInTheDocument();
    expect(screen.getByText('1 previous stay')).toBeInTheDocument();
    // A guest who originated in LSP has no migrated history and gets no badge.
    expect(screen.queryByText('0 previous stays')).not.toBeInTheDocument();
  });

  it('offers ranking by stay history, which the server does across the whole directory', () => {
    render(<GuestsPage />);
    expect(screen.getByRole('option', { name: 'Most previous stays' })).toBeInTheDocument();
  });

  it('swaps in the segment list when a segment is picked', async () => {
    const user = userEvent.setup();
    render(<GuestsPage />);
    expect(screen.getByText('Shinichiro Wada')).toBeInTheDocument();

    await user.selectOptions(screen.getByDisplayValue('Every guest'), 'vip');

    expect(screen.getByText('segment list: VIP')).toBeInTheDocument();
    expect(screen.queryByText('Shinichiro Wada')).not.toBeInTheDocument();
  });
});
