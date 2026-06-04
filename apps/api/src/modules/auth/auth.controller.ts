import type { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import * as authService from './auth.service.js';
import type { LoginInput } from './auth.schema.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function meta(req: Request, res: Response) {
  return {
    ip: req.ip,
    requestId: res.locals['requestId'] as string | undefined,
  };
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(env.JWT_REFRESH_COOKIE_NAME, token, COOKIE_OPTIONS);
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.JWT_REFRESH_COOKIE_NAME, { path: COOKIE_OPTIONS.path });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as LoginInput;
    const { tokens, user } = await authService.login(email, password, meta(req, res));

    setRefreshCookie(res, tokens.rawRefreshToken);

    res.status(200).json({
      accessToken: tokens.accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = req.cookies?.[env.JWT_REFRESH_COOKIE_NAME] as string | undefined;
    if (!rawToken) throw AppError.unauthorized('Refresh token missing');

    const { tokens, user } = await authService.refresh(rawToken, meta(req, res));

    setRefreshCookie(res, tokens.rawRefreshToken);

    res.status(200).json({
      accessToken: tokens.accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = req.cookies?.[env.JWT_REFRESH_COOKIE_NAME] as string | undefined;
    if (rawToken) {
      await authService.logout(rawToken, meta(req, res));
    }
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function logoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) throw AppError.unauthorized();

    await authService.logoutAll(userId, meta(req, res));
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user;
    if (!user) throw AppError.unauthorized();

    res.status(200).json({
      id: user.sub,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
    });
  } catch (err) {
    next(err);
  }
}
