import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// (R7 N7-4) Taking a unit out of service while guests are still booked into it used to
// succeed in silence. The server now asks (409 "Unit Has Bookings"); the page shows the
// question and offers to close it anyway.

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
const question = {
  response: { status: 409, data: { error: 'Unit Has Bookings', message: 'This unit still has 1 booking from today on.' } },
};

vi.mock('./RoomFormDrawer', () => ({ RoomFormDrawer: () => null }));
vi.mock('./hooks', () => ({
  useRooms: () => ({
    data: [
      { id: 'r0', code: 'DEMO-A1', name: 'A1', type: 'DELUXE', capacity: 3, status: 'MAINTENANCE', housekeeping_status: 'READY', ownership: 'COMPANY' },
      { id: 'r1', code: 'DEMO-D3', name: 'D3', type: 'DELUXE', capacity: 3, status: 'AVAILABLE', housekeeping_status: 'READY', ownership: 'COMPANY' },
    ],
    isLoading: false, isError: false, refetch: () => {},
  }),
  useRoomStatusAction: () => ({ mutate, isPending: false, variables: undefined }),
}));
vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: () => boolean }) => unknown) => sel({ hasPerm: () => true }),
}));

import { RoomsPage } from './RoomsPage';

describe('RoomsPage — closing a unit with bookings ahead', () => {
  beforeEach(() => {
    mutate.mockReset().mockImplementation((_vars, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(question));
  });

  it('shows the server’s question, and “close anyway” resends with the answer', () => {
    render(<RoomsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Out of service' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This unit still has 1 booking from today on.');

    mutate.mockReset();
    fireEvent.click(screen.getByRole('button', { name: /Take it out of service anyway/ }));
    expect(mutate).toHaveBeenCalledWith({ id: 'r1', action: 'out-of-service', confirm: true }, expect.anything());
  });

  it('lets the question be dismissed without changing anything', () => {
    render(<RoomsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Maintenance' }));
    mutate.mockReset();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it open' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  // (R8 #1) The question sat at the top of the page and never said which unit — easy to
  // miss after clicking a unit further down. It now opens right under that unit's row and
  // names it.
  it('asks right under the unit that was clicked, and names it', () => {
    render(<RoomsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Out of service' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('DEMO-D3');
    const unitRow = screen.getByText('DEMO-D3').closest('tr')!;
    expect(unitRow.nextElementSibling).toContainElement(alert);
  });
});

