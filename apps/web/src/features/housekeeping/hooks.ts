import { useMutation, useQueryClient } from '@tanstack/react-query';
import { transition, type HousekeepingAction } from '@/lib/api/housekeeping';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import { turnResult } from './util';

/**
 * Advance a unit's cleaning turn and refresh everything that shows unit state:
 * this board (rooms) and the cockpit board.
 */
export function useTurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, action }: { roomId: string; action: HousekeepingAction }) =>
      transition(roomId, action),
    onSuccess: (_data, { action }) => {
      toast.success(turnResult[action]);
      qc.invalidateQueries({ queryKey: ['rooms'] });
      qc.invalidateQueries({ queryKey: ['cockpit-board'] });
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
