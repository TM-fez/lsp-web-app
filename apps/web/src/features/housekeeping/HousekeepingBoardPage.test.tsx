import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import type { Room } from '@/types';

const rooms = [
  { id: '1', code: 'J1-01', name: 'Unit 1', status: 'OCCUPIED', housekeeping_status: 'DIRTY' },
  { id: '2', code: 'J1-02', name: 'Unit 2', status: 'AVAILABLE', housekeeping_status: 'CLEANING' },
  { id: '3', code: 'J1-03', name: 'Unit 3', status: 'AVAILABLE', housekeeping_status: 'INSPECTED' },
  { id: '4', code: 'J1-04', name: 'Unit 4', status: 'AVAILABLE', housekeeping_status: 'READY' },
] as unknown as Room[];

vi.mock('@/features/rooms/hooks', () => ({
  useRooms: () => ({ data: rooms, isLoading: false, dataUpdatedAt: Date.now() }),
}));

vi.mock('./hooks', () => ({
  useTurn: () => ({ isPending: false, mutate: vi.fn(), variables: undefined }),
  useRoomChecks: () => ({ data: undefined, isLoading: false }),
  useSetRoomCheck: () => ({ isPending: false, mutate: vi.fn() }),
}));

// A cleaner's tablet: can start cleans, cannot inspect or sign off.
vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: any) => any) =>
    sel({ hasPerm: (p: string) => ['housekeeping.read', 'housekeeping.update'].includes(p) }),
}));

import { HousekeepingBoardPage } from './HousekeepingBoardPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <HousekeepingBoardPage />
    </MemoryRouter>,
  );

describe('HousekeepingBoardPage', () => {
  it('groups every unit into its stage column', () => {
    renderPage();
    expect(screen.getByText('To clean')).toBeInTheDocument();
    expect(screen.getByText('Cleaning')).toBeInTheDocument();
    expect(screen.getByText('Awaiting sign-off')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    for (const code of ['J1-01', 'J1-02', 'J1-03', 'J1-04']) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
  });

  it('shows only the actions the signed-in user may take', () => {
    renderPage();
    // Cleaner: start on the DIRTY unit, checklist on the CLEANING unit…
    expect(screen.getByRole('button', { name: 'Start cleaning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checklist' })).toBeInTheDocument();
    // …but no supervisor validation or manager sign-off buttons.
    expect(screen.queryByRole('button', { name: 'Mark inspected' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign off' })).toBeNull();
  });

  it('links back out of the board', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Exit board' })).toHaveAttribute('href', '/housekeeping');
  });
});
