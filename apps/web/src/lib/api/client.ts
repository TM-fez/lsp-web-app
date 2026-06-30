import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/auth';
import { useActivePropertyStore } from '@/store/activeProperty';

// Same-origin by default so the dev proxy (vite.config.ts) keeps the refresh
// cookie first-party. Override with VITE_API_URL only for a true cross-origin API.
const baseURL = (import.meta.env.VITE_API_URL as string | undefined) || '/api/v1';

export const api = axios.create({ baseURL, withCredentials: true });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Declare the active property; the server enforces scope against it. Harmless
  // on non-scoped routes, which ignore it.
  const propertyId = useActivePropertyStore.getState().activePropertyId;
  if (propertyId) config.headers['X-Property-Id'] = propertyId;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function refreshToken(): Promise<string | null> {
  try {
    const res = await axios.post(`${baseURL}/auth/refresh`, null, { withCredentials: true });
    const { accessToken, user } = res.data;
    useAuthStore.getState().setAuth(accessToken, user);
    return accessToken as string;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const url = original?.url ?? '';
    const isAuthCall = url.includes('/auth/login') || url.includes('/auth/refresh');

    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      refreshing = refreshing ?? refreshToken();
      const token = await refreshing;
      refreshing = null;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);
