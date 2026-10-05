import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// (R6 #13) On a phone "Maintenance" and "Out of service" looked like plain text (ghost
// buttons), wrapped onto two lines and were small to tap. They are now outlined buttons
// that never wrap, at least 40 px tall on a phone, stacked one per line.

vi.mock('./RoomFormDrawer', () => ({ RoomFormDrawer: () => null }));
vi.mock('./hooks', () => ({
  useRooms: () => ({
    data: [{ id: 'r1', code: 'DEMO-D3', name: 'D3', type: 'DELUXE', capacity: 3, status: 'AVAILABLE', housekeeping_status: 'READY', ownership: 'COMPANY' }],
    isLoading: false, isError: false, refetch: () => {},
  }),
  useRoomStatusAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: () => boolean }) => unknown) => sel({ hasPerm: () => true }),
}));

import { RoomsPage } from './RoomsPage';

describe('RoomsPage actions on a phone', () => {
  it('renders the status actions as real, unwrapped, tappable buttons', () => {
    render(<RoomsPage />);
    for (const name of ['Maintenance', 'Out of service']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.className).toMatch(/whitespace-nowrap/);
      expect(btn.className).toMatch(/min-h-10/);
      expect(btn.className).toMatch(/border/); // outlined, not a bare-text ghost button
    }
  });
});
