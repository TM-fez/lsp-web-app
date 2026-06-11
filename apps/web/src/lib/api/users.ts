import { api } from './client';
import type { RoleInfo, RoleName, StaffUser } from '@/types';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: RoleName;
  is_lead?: boolean;
  extra_permissions?: string[];
}

export interface UpdateUserInput {
  name?: string;
  role?: RoleName;
  active?: boolean;
  is_lead?: boolean;
  extra_permissions?: string[];
}

export async function listUsers(): Promise<StaffUser[]> {
  const { data } = await api.get<{ data: StaffUser[] }>('/users');
  return data.data;
}

export async function listRoles(): Promise<RoleInfo[]> {
  const { data } = await api.get<{ data: RoleInfo[] }>('/users/roles');
  return data.data;
}

export async function createUser(input: CreateUserInput): Promise<StaffUser> {
  const { data } = await api.post<StaffUser>('/users', input);
  return data;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<StaffUser> {
  const { data } = await api.patch<StaffUser>(`/users/${id}`, input);
  return data;
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await api.post(`/users/${id}/reset-password`, { password });
}
