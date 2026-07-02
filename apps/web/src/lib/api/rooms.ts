import { api } from './client';
import type { Paginated, Room, RoomCreateStatus, RoomStatus, UnitType } from '@/types';

export interface CreateRoomInput {
  name: string;
  code: string;
  type: UnitType;
  status: RoomCreateStatus;
  capacity: number;
  notes?: string | null;
  building_id?: string | null;
  floor?: number | null;
}

export type UpdateRoomInput = Partial<
  Pick<CreateRoomInput, 'name' | 'code' | 'type' | 'capacity' | 'notes' | 'building_id' | 'floor'>
>;

export interface RoomListParams {
  search?: string;
  status?: RoomStatus;
  type?: UnitType;
  property_id?: string;
  building_id?: string;
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

export async function getRoom(id: string): Promise<Room> {
  const { data } = await api.get<Room>(`/rooms/${id}`);
  return data;
}

// Channel sync (H4): per-unit Booking.com import URL + export-token rotation.
export async function setRoomChannelConfig(id: string, bookingIcalUrl: string | null): Promise<Room> {
  const { data } = await api.patch<Room>(`/rooms/${id}/channel`, { booking_ical_url: bookingIcalUrl });
  return data;
}

export async function rotateRoomIcalToken(id: string): Promise<Room> {
  const { data } = await api.post<Room>(`/rooms/${id}/channel/rotate-token`, {});
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
