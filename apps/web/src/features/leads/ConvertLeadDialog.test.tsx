import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Lead } from '@/types';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./hooks', () => ({ useConvertLead: () => ({ mutateAsync, isPending: false }) }));
vi.mock('@/features/rooms/hooks', () => ({ useRooms: () => ({ data: [{ id: 'r1', code: '101', name: 'Garden Suite' }] }) }));
vi.mock('@/features/reservations/GuestPicker', () => ({ GuestPicker: () => <div data-testid="guest-picker" /> }));

import { ConvertLeadDialog } from './ConvertLeadDialog';

const lead: Lead = {
  id: 'L1', title: '2-bed for August', description: null, status: 'QUALIFIED',
  source: 'WHATSAPP', contact_id: 'c1', phone: null, created_at: '2026-07-01',
};

describe('ConvertLeadDialog', () => {
  beforeEach(() => mutateAsync.mockReset().mockResolvedValue({}));

  it('converts the enquiry with the chosen unit and dates', async () => {
    render(<ConvertLeadDialog open lead={lead} onOpenChange={() => {}} />);

    expect(screen.getByText('Convert to booking')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '101 — Garden Suite' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'r1' } });
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2027-01-10' } });
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2027-01-12' } });

    fireEvent.click(screen.getByRole('button', { name: /Create booking/ }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      id: 'L1',
      input: expect.objectContaining({ room_id: 'r1', check_in_date: '2027-01-10', check_out_date: '2027-01-12' }),
    }));
  });
});
