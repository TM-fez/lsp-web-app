import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// (R6, related to NEW-8) A CRITICAL repair over nights a guest is booked used to save with
// no warning. The server now asks (409 "Repair Overlap"); the drawer shows that question
// and a "Save anyway" that resends with confirm_overlap.

const createMutate = vi.fn();
const idle = { mutateAsync: vi.fn(), isPending: false };
vi.mock('./hooks', () => ({
  useCreateWorkOrder: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateWorkOrder: () => idle,
  useCancelWorkOrder: () => idle,
  useAssignWorkOrder: () => idle,
  useApproveWorkOrder: () => idle,
  useSetWorkOrderCost: () => idle,
  useStaffDirectory: () => ({ data: [] }),
}));
vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: () => boolean }) => unknown) => sel({ hasPerm: () => true }),
}));

import { MaintenanceFormDrawer } from './MaintenanceFormDrawer';

const rooms = [{ id: 'room-j4', code: 'J4', name: 'J Block 4' }] as never;

describe('MaintenanceFormDrawer — a repair over booked nights', () => {
  beforeEach(() => createMutate.mockReset());

  it('shows the server’s question, and Save anyway resends with confirm_overlap', async () => {
    createMutate
      .mockRejectedValueOnce({ response: { status: 409, data: { error: 'Repair Overlap', message: 'This unit has 1 booking on some of those nights.' } } })
      .mockResolvedValueOnce({});
    render(<MaintenanceFormDrawer open onOpenChange={() => {}} rooms={rooms} canUpdate />);

    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'room-j4' } });
    fireEvent.change(screen.getByLabelText('Repair'), { target: { value: 'Geyser burst' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'CRITICAL' } });
    fireEvent.change(screen.getByLabelText('Closed from'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('Back in use on'), { target: { value: '2026-10-23' } });
    fireEvent.click(screen.getByRole('button', { name: /Log repair/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('1 booking on some of those nights');
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(2));
    expect(createMutate.mock.calls[0]![0].confirm_overlap).toBeUndefined();
    expect(createMutate.mock.calls[1]![0]).toMatchObject({ confirm_overlap: true, blocks_from: '2026-10-20', blocks_to: '2026-10-23' });
  });
});
