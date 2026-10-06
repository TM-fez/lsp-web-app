import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getCalendar } from '@/lib/api/reservations';
import type { CalendarView } from '@/types';

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
