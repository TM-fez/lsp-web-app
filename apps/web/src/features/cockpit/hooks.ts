import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBoard } from '@/lib/api/cockpit';
import { checkIn, checkOut } from '@/lib/api/frontdesk';
import { transition, type HousekeepingAction } from '@/lib/api/housekeeping';
import { toast } from '@/store/toast';
import type { CockpitBoard } from '@/types';

const BOARD_KEY = ['cockpit-board'] as const;

export function useCockpitBoard() {
  return useQuery<CockpitBoard>({
    queryKey: BOARD_KEY,
    queryFn: getBoard,
    refetchInterval: 20_000,
  });
}

function errMessage(e: unknown): string {
  const anyErr = e as { response?: { data?: { message?: string; error?: string } } };
  return anyErr?.response?.data?.message || anyErr?.response?.data?.error || 'Something went wrong';
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reservationId: string) => checkIn(reservationId),
    onSuccess: () => {
      toast.success('Guest checked in');
      qc.invalidateQueries({ queryKey: BOARD_KEY });
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useCheckOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (occupancyId: string) => checkOut(occupancyId),
    onSuccess: () => {
      toast.success('Guest checked out — unit queued for cleaning');
      qc.invalidateQueries({ queryKey: BOARD_KEY });
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useHousekeepingTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, action }: { roomId: string; action: HousekeepingAction }) =>
      transition(roomId, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOARD_KEY });
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function invalidateBoardKey() {
  return BOARD_KEY;
}

export { errMessage };
