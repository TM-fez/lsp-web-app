import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getCalendar, getMovePreview } from '@/lib/api/reservations';
import type { CalendarView, MovePreview } from '@/types';

/**
 * Under the reservations key on purpose: every booking write (create, edit, cancel, payment,
 * refund) already invalidates ['reservations'], so the board redraws after any of them
 * without each mutation having to know the board exists.
 */
const CALENDAR_KEY = ['reservations', 'calendar'] as const;

export function useCalendar(from: string, days: number) {
  return useQuery<CalendarView>({
    queryKey: [...CALENDAR_KEY, from, days],
    queryFn: () => getCalendar(from, days),
    // Paging a week on keeps the old board up until the new one lands, instead of a spinner.
    placeholderData: keepPreviousData,
  });
}

/**
 * (Calendar drag) The confirm box's figures. Never cached past the box: by the time staff
 * press "Move", the server checks and prices again under the booking's lock anyway.
 */
export function useMovePreview(id: string, change: { room_id: string; check_in_date: string; check_out_date: string }) {
  return useQuery<MovePreview>({
    queryKey: [...CALENDAR_KEY, 'move-preview', id, change.room_id, change.check_in_date, change.check_out_date],
    queryFn: () => getMovePreview(id, change),
    gcTime: 0,
    staleTime: 0,
  });
}
