import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CalendarView } from '@/types';

const cal = vi.hoisted(() => ({
  value: { data: undefined as unknown, isLoading: false, isError: false, isFetching: false, refetch: () => {} },
  calls: [] as [string, number][],
}));
const preview = vi.hoisted(() => ({ value: { data: undefined as unknown, isLoading: false, isError: false }, calls: [] as unknown[] }));
vi.mock('./hooks', () => ({
  useCalendar: (from: string, days: number) => {
    cal.calls.push([from, days]);
    return cal.value;
  },
  useMovePreview: (id: string, change: unknown) => {
    preview.calls.push([id, change]);
    return preview.value;
  },
}));
const updateMutate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/date', () => ({ todayISO: () => '2026-10-05' }));
vi.mock('@/features/reservations/hooks', () => ({
  useReservation: (id: string) => ({ data: { id, status: 'CONFIRMED', room_id: 'b1' } }),
  useReservations: () => ({ data: { data: [] }, isLoading: false }),
  useUpdateReservation: () => ({ mutateAsync: updateMutate, isPending: false }),
}));
vi.mock('@/features/rooms/hooks', () => ({ useRooms: () => ({ data: [] }) }));
const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('@/store/auth', () => ({
  useAuthStore: (sel: (s: { hasPerm: (p: string) => boolean }) => unknown) => sel({ hasPerm: (p) => perms.set.has(p) }),
}));
vi.mock('@/features/reservations/ReservationFormDrawer', () => ({
  ReservationFormDrawer: ({ reservation, initial }: { reservation: { id: string; guest_name?: string } | null; initial?: { room_id?: string; check_in_date?: string; check_out_date?: string } }) =>
    reservation ? (
      <div role="dialog">Booking {reservation.id} for {reservation.guest_name}</div>
    ) : (
      <div role="dialog">New booking {initial?.room_id ?? 'any'} {initial?.check_in_date ?? ''} {initial?.check_out_date ?? ''}</div>
    ),
}));

import { CalendarPage } from './CalendarPage';

// jsdom has no PointerEvent, so fireEvent.pointer* would drop clientX / button / pointerType.
if (!('PointerEvent' in window)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

const view = (over: Partial<CalendarView> = {}): CalendarView => ({
  from: '2026-10-05', to: '2026-11-02', today: '2026-10-05',
  units: [
    { id: 'b1', code: 'B1', name: 'B1', type: 'STANDARD', status: 'AVAILABLE', building_name: 'Block B' },
    { id: 'b2', code: 'B2', name: 'B2', type: 'STANDARD', status: 'AVAILABLE', building_name: 'Block B' },
    { id: 's1', code: 'S1', name: 'S1', type: 'SUITE', status: 'OUT_OF_SERVICE', building_name: null },
  ],
  bookings: [
    { id: 'r1', room_id: 'b1', check_in_date: '2026-09-28', check_out_date: '2026-11-15', status: 'CHECKED_IN', source: 'CORPORATE',
      guest_name: 'Alexander Forbes', company_name: 'Financial Services Botswana', payment_incomplete: false, fully_refunded: false },
    { id: 'r2', room_id: 'b2', check_in_date: '2026-10-25', check_out_date: '2026-10-27', status: 'CONFIRMED', source: 'DIRECT',
      guest_name: 'Garth Miller', company_name: null, payment_incomplete: true, fully_refunded: false },
  ],
  closures: [
    { room_id: 's1', kind: 'OUT_OF_SERVICE', from: null, to: null, label: 'Closed — out of service', ref_id: null },
  ],
  ...over,
});

const renderPage = () => render(<MemoryRouter><CalendarPage /></MemoryRouter>);

beforeEach(() => {
  cal.calls = [];
  perms.set = new Set(['reservations.read', 'reservations.create', 'reservations.update', 'maintenance.create', 'maintenance.read']);
  cal.value = { data: view(), isLoading: false, isError: false, isFetching: false, refetch: () => {} };
});

describe('CalendarPage', () => {
  it('lays out units by type with LH’s day headers, today marked', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Standard/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Suite/ })).toBeInTheDocument();
    expect(screen.getByText('TODAY')).toBeInTheDocument();
    expect(cal.calls.at(-1)).toEqual(['2026-10-05', 28]);
    expect(screen.getByTestId('unit-row-B1')).toBeInTheDocument();
  });

  it('draws each stay as "Company, Guest" with the incomplete-payment corner, and closures in words', () => {
    renderPage();
    const b1 = within(screen.getByTestId('unit-row-B1'));
    expect(b1.getByText('Financial Services Botswana, Alexander Forbes')).toBeInTheDocument();
    expect(b1.queryByLabelText('Payment incomplete')).toBeNull();
    const b2 = within(screen.getByTestId('unit-row-B2'));
    expect(b2.getByText('Garth Miller')).toBeInTheDocument();
    expect(b2.getByLabelText('Payment incomplete')).toBeInTheDocument();
    expect(within(screen.getByTestId('unit-row-S1')).getByText('Closed — out of service')).toBeInTheDocument();
    expect(screen.getByText('Incomplete payment')).toBeInTheDocument();
  });

  // (Round 11) The fixed 5.5rem column cut long codes to "DEMO-…".
  it('shows each unit’s full code, however long', () => {
    cal.value = { ...cal.value, data: view({
      units: [{ id: 'b1', code: 'DEMO-B12-LOFT', name: 'Loft', type: 'STANDARD', status: 'AVAILABLE', building_name: null }],
      bookings: [], closures: [],
    }) };
    renderPage();
    const name = within(screen.getByTestId('unit-row-DEMO-B12-LOFT')).getByText('DEMO-B12-LOFT');
    expect(name).not.toHaveClass('truncate');
    expect(name.parentElement!.style.width).toBe('var(--unit-col)');
    let board: HTMLElement | null = name.parentElement;
    while (board && !board.style.getPropertyValue('--unit-col')) board = board.parentElement;
    expect(board?.style.getPropertyValue('--unit-col')).toBe('max(5.5rem, calc(13ch + 1.75rem))');
  });

  // (Round 11) A fully refunded stay looked like any other bar.
  it('marks a fully refunded stay so it doesn’t read as paid', () => {
    cal.value = { ...cal.value, data: view({
      bookings: [
        { id: 'r2', room_id: 'b2', check_in_date: '2026-10-25', check_out_date: '2026-10-27', status: 'CONFIRMED', source: 'DIRECT',
          guest_name: 'Garth Miller', company_name: null, payment_incomplete: false, fully_refunded: true },
      ],
    }) };
    renderPage();
    const bar = screen.getByText('Garth Miller').closest('button')!;
    expect(bar).toHaveAttribute('data-refunded', 'true');
    expect(bar.getAttribute('title')).toContain('fully refunded');
    expect(within(bar).getByLabelText('Fully refunded')).toBeInTheDocument();
  });

  it('opens the booking when its bar is tapped', () => {
    renderPage();
    fireEvent.click(screen.getByText('Garth Miller'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Booking r2 for Garth Miller');
  });

  it('starts a one-night booking on that unit when an empty square is tapped — never in the past', () => {
    renderPage();
    const squares = screen.getAllByRole('button', { name: /New booking: B2 from/ });
    // Today plus 27 more nights — every square on screen is today or later.
    expect(squares).toHaveLength(28);
    fireEvent.click(squares[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('New booking b2 2026-10-05 2026-10-06');
  });

  it('does not offer squares before today when paging back', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Back a week' }));
    // 28 nights from 28 Sep: the 7 before today are not offered.
    expect(screen.getAllByRole('button', { name: /New booking: B2 from/ })).toHaveLength(21);
  });

  it('pages a day, a week and the whole view, and comes back to today', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Forward a day' }));
    expect(cal.calls.at(-1)).toEqual(['2026-10-06', 28]);
    fireEvent.click(screen.getByRole('button', { name: 'Forward a week' }));
    expect(cal.calls.at(-1)).toEqual(['2026-10-13', 28]);
    fireEvent.click(screen.getByRole('button', { name: 'Back 28 days' }));
    expect(cal.calls.at(-1)).toEqual(['2026-09-15', 28]);
    fireEvent.change(screen.getByLabelText('Nights shown'), { target: { value: '7' } });
    expect(cal.calls.at(-1)).toEqual(['2026-09-15', 7]);
    fireEvent.click(screen.getByRole('button', { name: 'View today' }));
    expect(cal.calls.at(-1)).toEqual(['2026-10-05', 7]);
  });

  it('collapses a unit type like LH', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Standard/ }));
    expect(screen.queryByTestId('unit-row-B1')).toBeNull();
    expect(screen.getByTestId('unit-row-S1')).toBeInTheDocument();
  });

  it('offers no new-booking squares or buttons to someone who can only look', () => {
    perms.set = new Set(['reservations.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /New booking:/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reservation/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Room closure/ })).toBeNull();
  });

  it('says why the board is empty, and retries when it could not load', () => {
    cal.value = { ...cal.value, data: view({ units: [], bookings: [], closures: [] }) };
    const { unmount } = renderPage();
    expect(screen.getByText('No units in this property yet')).toBeInTheDocument();
    unmount();
    const refetch = vi.fn();
    cal.value = { data: undefined, isLoading: false, isError: true, isFetching: false, refetch };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  // (Calendar drag) Drag a bar to move a stay; nothing is saved until "Move booking".
  describe('dragging a booking', () => {
    const DAY = 40; // px per night: the track is 28 × 40 wide
    function track(rowCode: string) {
      const row = screen.getByTestId(`unit-row-${rowCode}`);
      const t = row.querySelector('[data-track]') as HTMLElement;
      t.getBoundingClientRect = () => ({ width: 28 * DAY, height: 44, top: 0, left: 0, right: 28 * DAY, bottom: 44, x: 0, y: 0, toJSON: () => ({}) });
      return row;
    }
    beforeEach(() => {
      updateMutate.mockReset().mockResolvedValue({});
      preview.calls = [];
      preview.value = {
        data: { allowed: true, reason: null, current_total: 222_300, new_total: 296_400, total_source: 'FOLIO', opens_cleaning_task: false, paid_amount: 0 },
        isLoading: false, isError: false,
      };
    });

    it('moves a stay two nights later and to another unit, asking first and showing the price change', async () => {
      renderPage();
      track('B2');
      const b1 = track('B1');
      document.elementFromPoint = vi.fn(() => b1);
      fireEvent.pointerDown(screen.getByText('Garth Miller').closest('button')!, { clientX: 500, clientY: 10, button: 0 });
      fireEvent.pointerMove(window, { clientX: 500 + 2 * DAY + 5, clientY: 10 });
      expect(screen.getByTestId('drag-ghost')).toBeInTheDocument();
      fireEvent.pointerUp(window);

      expect(preview.calls.at(-1)).toEqual(['r2', { room_id: 'b1', check_in_date: '2026-10-27', check_out_date: '2026-10-29' }]);
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('From B2 ·');
      expect(dialog).toHaveTextContent('To B1 ·');
      expect(screen.getByTestId('move-price')).toHaveTextContent('The agreed price changes from BWP 2,223.00 to BWP 2,964.00 (+BWP 741.00).');
      expect(updateMutate).not.toHaveBeenCalled();
      // The drop did not also open the booking.
      expect(screen.queryByText(/Booking r2 for/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Move booking' }));
      await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({
        id: 'r2', input: { room_id: 'b1', check_in_date: '2026-10-27', check_out_date: '2026-10-29' },
      }));
    });

    // (Round 11) The box said how the PRICE moves, not what the guest then owes or is owed.
    async function dragGarthOneNight() {
      renderPage();
      const b2 = track('B2');
      document.elementFromPoint = vi.fn(() => b2);
      fireEvent.pointerDown(screen.getByText('Garth Miller').closest('button')!, { clientX: 500, clientY: 10, button: 0 });
      fireEvent.pointerMove(window, { clientX: 500 + DAY + 5, clientY: 10 });
      fireEvent.pointerUp(window);
      return screen.findByTestId('move-balance');
    }

    it('says how much the guest will owe after the move', async () => {
      preview.value = { ...preview.value, data: { ...(preview.value.data as object), paid_amount: 222_300 } };
      expect(await dragGarthOneNight()).toHaveTextContent(
        'After the move the guest will owe BWP 741.00 (BWP 2,223.00 already paid).'
      );
    });

    it('says when the guest will be due a refund after the move', async () => {
      preview.value = { ...preview.value, data: { ...(preview.value.data as object), new_total: 148_200, paid_amount: 222_300 } };
      expect(await dragGarthOneNight()).toHaveTextContent(
        'After the move the guest will be due a refund of BWP 741.00 — they have paid BWP 2,223.00.'
      );
    });

    it('stretches a stay by its right edge without changing unit or arrival', () => {
      renderPage();
      const b2 = track('B2');
      document.elementFromPoint = vi.fn(() => b2);
      const handle = screen.getByText('Garth Miller').closest('button')!.querySelector('[data-resize]')!;
      fireEvent.pointerDown(handle, { clientX: 800, clientY: 10, button: 0 });
      fireEvent.pointerMove(window, { clientX: 800 + 3 * DAY, clientY: 10 });
      fireEvent.pointerUp(window);
      expect(preview.calls.at(-1)).toEqual(['r2', { room_id: 'b2', check_in_date: '2026-10-25', check_out_date: '2026-10-30' }]);
    });

    it('says why a move is refused and offers nothing to confirm', async () => {
      preview.value = { data: { allowed: false, reason: 'That unit isn’t free for those nights — another booking, a closure or a repair is in the way.', current_total: 222_300, new_total: null, total_source: 'FOLIO', opens_cleaning_task: false, paid_amount: 0 }, isLoading: false, isError: false };
      renderPage();
      const b2 = track('B2');
      document.elementFromPoint = vi.fn(() => b2);
      fireEvent.pointerDown(screen.getByText('Garth Miller').closest('button')!, { clientX: 500, clientY: 10, button: 0 });
      fireEvent.pointerMove(window, { clientX: 500 - DAY, clientY: 10 });
      fireEvent.pointerUp(window);
      expect(await screen.findByRole('alert')).toHaveTextContent('isn’t free');
      expect(screen.queryByRole('button', { name: 'Move booking' })).not.toBeInTheDocument();
    });

    it('treats a press without movement as a tap that opens the booking', () => {
      renderPage();
      track('B2');
      const bar = screen.getByText('Garth Miller').closest('button')!;
      fireEvent.pointerDown(bar, { clientX: 500, clientY: 10, button: 0 });
      fireEvent.pointerUp(window);
      fireEvent.click(bar);
      expect(preview.calls).toHaveLength(0);
      expect(screen.getByRole('dialog')).toHaveTextContent('Booking r2 for Garth Miller');
    });

    it('does not drag for someone who can only look, nor on a touch screen', () => {
      perms.set = new Set(['reservations.read']);
      renderPage();
      const b1 = track('B1');
      track('B2');
      document.elementFromPoint = vi.fn(() => b1);
      fireEvent.pointerDown(screen.getByText('Garth Miller').closest('button')!, { clientX: 500, clientY: 10, button: 0 });
      fireEvent.pointerMove(window, { clientX: 600, clientY: 10 });
      fireEvent.pointerUp(window);
      expect(preview.calls).toHaveLength(0);
    });

    it('keeps the checked-in stay’s arrival when dragged sideways on its own row (nothing to confirm)', () => {
      renderPage();
      const b1 = track('B1');
      document.elementFromPoint = vi.fn(() => b1);
      fireEvent.pointerDown(screen.getByText('Financial Services Botswana, Alexander Forbes').closest('button')!, { clientX: 300, clientY: 10, button: 0 });
      fireEvent.pointerMove(window, { clientX: 300 + 2 * DAY, clientY: 10 });
      fireEvent.pointerUp(window);
      expect(preview.calls).toHaveLength(0);
    });
  });
});
