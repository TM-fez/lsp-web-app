import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// This board is read off a tablet, on wifi, by the least technical users in the
// business. When the fetch failed it rendered four columns of zero under a "Live"
// label — which reads as "every room is done", not "I cannot see the rooms".

let state: Record<string, unknown> = {};

vi.mock('@/features/rooms/hooks', () => ({ useRooms: () => state }));
vi.mock('./hooks', () => ({ useTurn: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('./ChecklistDialog', () => ({ ChecklistDialog: () => null }));

vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: (p: string) => boolean }) => unknown) =>
    sel({ hasPerm: () => true }),
}));

import { HousekeepingBoardPage } from './HousekeepingBoardPage';

const show = () => render(<MemoryRouter><HousekeepingBoardPage /></MemoryRouter>);

describe('HousekeepingBoardPage', () => {
  it('says the board could not load rather than showing an empty one', () => {
    state = { data: undefined, isLoading: false, isError: true, refetch: vi.fn(), dataUpdatedAt: 0 };
    show();

    expect(screen.getByText(/couldn’t load/i)).toBeInTheDocument();
    expect(screen.getByText(/not an empty board/i)).toBeInTheDocument();
    // The columns must not render — a "0" beside "To clean" is the lie being fixed.
    expect(screen.queryByText('To clean')).not.toBeInTheDocument();
  });

  it('stops calling itself Live while the connection is down', () => {
    state = {
      data: [{ id: 'r1', code: 'B1', name: 'B1', housekeeping_status: 'DIRTY', status: 'AVAILABLE' }],
      isLoading: false, isError: true, refetch: vi.fn(), dataUpdatedAt: Date.now(),
    };
    show();

    expect(screen.getByText(/lost contact with the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Live —/)).not.toBeInTheDocument();
    // Stale data is still shown — better than a blank board, as long as it is labelled.
    expect(screen.getByText('To clean')).toBeInTheDocument();
  });

  it('reads as Live when it is', () => {
    state = {
      data: [{ id: 'r1', code: 'B1', name: 'B1', housekeeping_status: 'READY', status: 'AVAILABLE' }],
      isLoading: false, isError: false, refetch: vi.fn(), dataUpdatedAt: Date.now(),
    };
    show();

    expect(screen.getByText(/Live —/)).toBeInTheDocument();
    expect(screen.queryByText(/lost contact/i)).not.toBeInTheDocument();
  });
});
