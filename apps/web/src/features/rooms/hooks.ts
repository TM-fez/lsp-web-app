import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listRooms,
  getRoom,
  createRoom,
  updateRoom,
  deleteRoom,
  setRoomMaintenance,
  setRoomOutOfService,
  restoreRoom,
  setRoomChannelConfig,
  rotateRoomIcalToken,
  type CreateRoomInput,
  type UpdateRoomInput,
} from '@/lib/api/rooms';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { Room } from '@/types';

const ROOMS_KEY = ['rooms'] as const;

export function useRooms(opts: { refetchInterval?: number } = {}) {
  return useQuery<Room[]>({ queryKey: ROOMS_KEY, queryFn: () => listRooms(), ...opts });
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

/** Full unit row (incl. channel-sync fields the list endpoint omits). */
export function useRoom(id: string | undefined) {
  return useQuery<Room>({
    queryKey: [...ROOMS_KEY, id],
    queryFn: () => getRoom(id!),
    enabled: Boolean(id),
  });
}

export function useSetChannelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, url }: { id: string; url: string | null }) => setRoomChannelConfig(id, url),
    onSuccess: (_room, { url }) => {
      toast.success(url ? 'Booking.com calendar linked' : 'Booking.com calendar unlinked');
      qc.invalidateQueries({ queryKey: ROOMS_KEY });
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useRotateIcalToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rotateRoomIcalToken(id),
    onSuccess: () => {
      toast.success('Export link rotated — update it in the Booking.com extranet');
      qc.invalidateQueries({ queryKey: ROOMS_KEY });
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
