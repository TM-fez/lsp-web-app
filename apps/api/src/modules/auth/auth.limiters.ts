import { rateLimit } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { env } from '../../config/env.js';

/**
 * How many times bigger the "wide" login gates (one IP across all emails, one email across
 * all IPs) are than the tight per-IP-and-email gate. Wide enough that a handful of someone
 * else's wrong guesses can't lock a real person out, narrow enough that spraying passwords
 * still hits a wall within a minute.
 */
const WIDE_GATE_FACTOR = 5;

const tooMany = { statusCode: 429, error: 'Too Many Requests', message: 'Too many login attempts' };

const emailOf = (req: Request): string =>
  (typeof req.body?.email === 'string' && req.body.email.trim().toLowerCase()) || '';

function failedLoginGate(max: number, keyGenerator: (req: Request) => string): RequestHandler {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Only FAILED logins use up the allowance. A successful sign-in answers 2xx and is
    // given back, so a person who gets in on the second try is never counted against,
    // and someone else's typos never block a correct password from the same office/NAT.
    skipSuccessfulRequests: true,
    keyGenerator,
    message: tooMany,
  });
}

/**
 * The three login gates, all counting failures only:
 *  1. this caller (IP) trying this account (email) — the tight one, RATE_LIMIT_AUTH_MAX.
 *     Keyed by BOTH, so a stranger's failed attempts on your email from another address, or
 *     a colleague's typos from the same office address, can't lock you out of your account.
 *  2. one IP across all emails — stops password spraying from a single machine.
 *  3. one email across all IPs — still caps a distributed (or X-Forwarded-For-spoofed)
 *     guessing run against one account, but at a ceiling too high to be a casual lockout.
 */
export function createLoginLimiters(): RequestHandler[] {
  const tight = env.RATE_LIMIT_AUTH_MAX;
  const wide = tight * WIDE_GATE_FACTOR;
  return [
    failedLoginGate(tight, (req) => `${req.ip ?? 'unknown'}|${emailOf(req)}`),
    failedLoginGate(wide, (req) => req.ip ?? 'unknown'),
    failedLoginGate(wide, (req) => emailOf(req) || req.ip || 'unknown'),
  ];
}
