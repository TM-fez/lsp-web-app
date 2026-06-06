import { api } from './client';
import type { LoginResponse } from '@/types';

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}
