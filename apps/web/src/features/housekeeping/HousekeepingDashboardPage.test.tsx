import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import type { Room } from '@/types';

// Five units: 1 dirty, 1 cleaning, 1 inspected, 2 ready → 3 need attention.
const rooms = [
  { id: '1', code: 'J1-01', name: 'Unit 1', status: 'OCCUPIED', housekeeping_status: 'DIRTY' },
  { id: '2', code: 'J1-02', name: 'Unit 2', status: 'AVAILABLE', housekeeping_status: 'CLEANING' },
  { id: '3', code: 'J1-03', name: 'Unit 3', status: 'AVAILABLE', housekeeping_status: 'INSPECTED' },
  { id: '4', code: 'J1-04', name: 'Unit 4', status: 'AVAILABLE', housekeeping_status: 'READY' },
  { id: '5', code: 'J1-05', name: 'Unit 5', status: 'AVAILABLE', housekeeping_status: 'READY' },
] as unknown as Room[];

vi.mock('@/features/rooms/hooks', () => ({
  useRooms: () => ({ data: rooms, isLoading: false, isError: false, refetch: () => {} }),
}));

vi.mock('./hooks', () => ({
  useTurn: () => ({ isPending: false, mutate: vi.fn(), variables: undefined }),
  useTurnaround: () => ({ data: { days: 30, completed: 4, avg_minutes: 95 } }),
}));

import { HousekeepingDashboardPage } from './HousekeepingDashboardPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <HousekeepingDashboardPage />
    </MemoryRouter>,
  );

describe('HousekeepingDashboardPage', () => {
  it('summarises the four states and the attention count', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Housekeeping' })).toBeInTheDocument();
    expect(screen.getByText('3 of 5 units need attention')).toBeInTheDocument();
    expect(screen.getByText('To clean')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Awaiting sign-off')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('lists only the units that need attention (READY units excluded)', () => {
    renderPage();
    expect(screen.getByText('Needs attention now')).toBeInTheDocument();
    expect(screen.getByText('J1-01')).toBeInTheDocument(); // dirty
    expect(screen.getByText('J1-02')).toBeInTheDocument(); // cleaning
    expect(screen.getByText('J1-03')).toBeInTheDocument(); // inspected
    expect(screen.queryByText('J1-04')).toBeNull(); // ready → not in the list
  });

  it('links to the full queue', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'View full queue' });
    expect(link).toHaveAttribute('href', '/housekeeping/all');
  });
});
