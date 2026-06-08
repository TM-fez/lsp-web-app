import { api } from './client';
import type { Paginated, Room, RoomCreateStatus, RoomStatus, UnitType } from '@/types';

export interface CreateRoomInput {
  name: string;
  code: string;
  type: UnitType;
  status: RoomCreateStatus;
  capacity: number;
  notes?: string | null;
}

export type UpdateRoomInput = Partial<Pick<CreateRoomInput, 'name' | 'code' | 'type' | 'capacity' | 'notes'>>;

export interface RoomListParams {
  search?: string;
  status?: RoomStatus;
  type?: UnitType;
}

function unwrap(data: unknown): Room[] {
  if (Array.isArray(data)) return data as Room[];
  return ((data as Paginated<Room>)?.data ?? []) as Room[];
}

export async function listRooms(params?: RoomListParams): Promise<Room[]> {
  const { data } = await api.get('/rooms', { params: { limit: 200, ...params } });
  return unwrap(data);
}

export async function createRoom(input: CreateRoomInput): Promise<Room> {
  const { data } = await api.post<Room>('/rooms', input);
  return data;
}

export async function updateRoom(id: string, input: UpdateRoomInput): Promise<Room> {
  const { data } = await api.patch<Room>(`/rooms/${id}`, input);
  return data;
}

export async function setRoomMaintenance(id: string): Promise<Room> {
  const { data } = await api.post<Room>(`/rooms/${id}/maintenance`, {});
  return data;
}

export async function setRoomOutOfService(id: string): Promise<Room> {
  const { data } = await api.post<Room>(`/rooms/${id}/out-of-service`, {});
  return data;
}

export async function restoreRoom(id: string): Promise<Room> {
  const { data } = await api.post<Room>(`/rooms/${id}/restore`, {});
  return data;
}

export async function deleteRoom(id: string): Promise<void> {
  await api.delete(`/rooms/${id}`);
}
