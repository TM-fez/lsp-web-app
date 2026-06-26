import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import type { Room, WorkOrder, Paginated } from '@/types';

const rooms = [
  { id: 'r1', code: 'J1-01', name: 'Unit 1' },
  { id: 'r2', code: 'J1-02', name: 'Unit 2' },
] as unknown as Room[];

// 2 active (1 critical/blocked, 1 high/open) + 1 completed → 2 need attention.
const orders = [
  { id: 'w1', room_id: 'r1', title: 'Leaking tap', status: 'OPEN', priority: 'HIGH', opened_at: '2026-06-01' },
  { id: 'w2', room_id: 'r2', title: 'Broken AC', status: 'BLOCKED', priority: 'CRITICAL', opened_at: '2026-06-02' },
  { id: 'w3', room_id: 'r1', title: 'Repaint wall', status: 'COMPLETED', priority: 'LOW', opened_at: '2026-05-01' },
] as unknown as WorkOrder[];

vi.mock('@/features/rooms/hooks', () => ({
  useRooms: () => ({ data: rooms, isLoading: false, isError: false, refetch: () => {} }),
}));

vi.mock('./hooks', () => ({
  useWorkOrders: () => ({
    data: { data: orders, total: orders.length, page: 1, limit: 100 } as Paginated<WorkOrder>,
    isLoading: false,
    isError: false,
    refetch: () => {},
  }),
  useStartWorkOrder: () => ({ isPending: false, mutate: vi.fn(), variables: undefined }),
  useCompleteWorkOrder: () => ({ isPending: false, mutate: vi.fn(), variables: undefined }),
}));

import { MaintenanceDashboardPage } from './MaintenanceDashboardPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <MaintenanceDashboardPage />
    </MemoryRouter>,
  );

describe('MaintenanceDashboardPage', () => {
  it('summarises active work orders and the attention count', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Maintenance' })).toBeInTheDocument();
    expect(screen.getByText('2 work orders need attention')).toBeInTheDocument();
    // Assert tiles by their unique hint copy ("Open"/"Critical" also appear as row badges).
    expect(screen.getByText('Logged, not started')).toBeInTheDocument();
    expect(screen.getByText('Being worked on')).toBeInTheDocument();
    expect(screen.getByText('Stuck — needs a nudge')).toBeInTheDocument();
    expect(screen.getByText('Urgent, still open')).toBeInTheDocument();
  });

  it('lists active orders worst-first and excludes completed ones', () => {
    renderPage();
    expect(screen.getByText('Needs attention now')).toBeInTheDocument();
    expect(screen.getByText('Broken AC')).toBeInTheDocument(); // critical/blocked
    expect(screen.getByText('Leaking tap')).toBeInTheDocument(); // high/open
    expect(screen.getByText('J1-02')).toBeInTheDocument(); // unit resolved from room_id
    expect(screen.queryByText('Repaint wall')).toBeNull(); // completed → excluded
  });

  it('links to the full board', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'View full board' })).toHaveAttribute('href', '/maintenance/all');
  });
});
