import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// "Add guest" is a money-adjacent double-submit risk (two identical contacts, two sets of
// invoices later). Each time the drawer opens it mints ONE Idempotency-Key; every submit
// from that open carries it, so a repeat replays the first guest.

const createMutate = vi.fn();
vi.mock('./hooks', () => ({
  useCreateGuest: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateGuest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteGuest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { GuestFormDrawer } from './GuestFormDrawer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup(open = true) {
  return render(<GuestFormDrawer open={open} onOpenChange={() => {}} guest={null} />);
}

describe('GuestFormDrawer — add guest', () => {
  beforeEach(() => createMutate.mockReset().mockResolvedValue({}));

  it('sends the guest with an Idempotency-Key', async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: 'Neo Kgosi' } });
    fireEvent.click(screen.getByRole('button', { name: /Add guest/ }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0]![0];
    expect(arg.input.name).toBe('Neo Kgosi');
    expect(arg.idempotencyKey).toMatch(UUID);
  });

  // (R6 item 20) Two clicks before the button greys out sent two requests and showed two
  // "Guest added" toasts. The second click while the first is in flight does nothing.
  it('ignores a second click while the first add is still in flight', async () => {
    let resolve!: (v: unknown) => void;
    createMutate.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    setup();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Neo Kgosi' } });
    fireEvent.click(screen.getByRole('button', { name: /Add guest/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add guest/ }));
    resolve({});
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('reuses the key for a retry within the same open, and a fresh one after reopening', async () => {
    createMutate.mockRejectedValueOnce(new Error('network'));
    const { rerender } = setup();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: 'Neo Kgosi' } });
    fireEvent.click(screen.getByRole('button', { name: /Add guest/ }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Add guest/ }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(2));
    const [a, b] = createMutate.mock.calls.map((c) => c[0].idempotencyKey);
    expect(b).toBe(a);

    rerender(<GuestFormDrawer open={false} onOpenChange={() => {}} guest={null} />);
    rerender(<GuestFormDrawer open onOpenChange={() => {}} guest={null} />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: 'Neo Kgosi' } });
    fireEvent.click(screen.getByRole('button', { name: /Add guest/ }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(3));
    expect(createMutate.mock.calls[2]![0].idempotencyKey).not.toBe(a);
  });

  // (R5) Another guest uses this email: the form asks, and "Save anyway" resends with the flag.
  it('asks before saving a duplicate email, and Save anyway resends with the flag', async () => {
    createMutate.mockRejectedValueOnce({ response: { status: 409, data: { error: 'Duplicate Email', message: 'x' } } });
    setup();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Neo Kgosi' } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'neo@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add guest/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Another guest already uses this email');

    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(2));
    expect(createMutate.mock.calls[0]![0].input.allow_duplicate_email).toBeUndefined();
    expect(createMutate.mock.calls[1]![0].input.allow_duplicate_email).toBe(true);
  });
});

describe('GuestFormDrawer — contacting a saved guest', () => {
  it('offers Call and WhatsApp beside the phone number', () => {
    render(
      <GuestFormDrawer
        open
        onOpenChange={() => {}}
        guest={{ id: 'c1', type: 'individual', name: 'Neo Kgosi', email: null, phone: '71 234 567', company: null, address: null, notes: null } as never}
      />
    );
    expect(screen.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+26771234567');
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toBeInTheDocument();
  });
});

