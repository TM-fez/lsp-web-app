import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  setRoomMaintenance,
  setRoomOutOfService,
  restoreRoom,
  type CreateRoomInput,
  type UpdateRoomInput,
} from '@/lib/api/rooms';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { Room } from '@/types';

const ROOMS_KEY = ['rooms'] as const;

export function useRooms() {
  return useQuery<Room[]>({ queryKey: ROOMS_KEY, queryFn: () => listRooms() });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ROOMS_KEY });
}

export function useCreateRoom() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateRoomInput) => createRoom(input),
    onSuccess: () => {
      toast.success('Unit created');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateRoom() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRoomInput }) => updateRoom(id, input),
    onSuccess: () => {
      toast.success('Unit updated');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useDeleteRoom() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteRoom(id),
    onSuccess: () => {
      toast.success('Unit removed');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export type RoomStatusAction = 'maintenance' | 'out-of-service' | 'restore';

const STATUS_FN: Record<RoomStatusAction, (id: string) => Promise<Room>> = {
  maintenance: setRoomMaintenance,
  'out-of-service': setRoomOutOfService,
  restore: restoreRoom,
};

const STATUS_MSG: Record<RoomStatusAction, string> = {
  maintenance: 'Unit set to maintenance',
  'out-of-service': 'Unit taken out of service',
  restore: 'Unit restored to available',
};

export function useRoomStatusAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: RoomStatusAction }) => STATUS_FN[action](id),
    onSuccess: (_data, { action }) => {
      toast.success(STATUS_MSG[action]);
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
