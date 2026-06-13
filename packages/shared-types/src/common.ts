export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  search?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  avatarFileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  role: string;
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
  role?: string;
  active?: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  uptime?: number;
}

export interface ReadinessResponse {
  status: 'ok' | 'error';
  db: 'connected' | 'error';
  migrations: 'current' | 'pending' | 'error';
  detail?: string;
}

export interface StorageHealthResponse {
  status: 'ok' | 'error';
  driver: 'local' | 's3';
  latencyMs: number;
  detail?: string;
}
