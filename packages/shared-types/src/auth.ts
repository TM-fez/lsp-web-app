export type Role =
  | 'admin'
  | 'reception'
  | 'operations'
  | 'housekeeping'
  | 'maintenance'
  | 'accounts'
  | 'contractor';

export interface JwtPayload {
  sub: string;        // user id
  email: string;
  role: Role;
  permissions: string[];
  /** (H7) Login session id — the token is honoured only while the session is open. */
  sid?: string;
  iat?: number;
  exp?: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: string[];
}

export interface RefreshResponse {
  accessToken: string;
}
