import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * The app logger. JSON lines to stdout in production (Render captures them and they
 * stay grep-able/parseable); pretty-printed in local dev. Level comes from LOG_LEVEL.
 *
 * Use child bindings for context instead of string interpolation, e.g.
 *   logger.error({ requestId, err }, 'sweep failed')
 * so the fields stay queryable once the logs land anywhere structured.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  // In tests keep the logger quiet unless something is genuinely wrong.
  ...(env.NODE_ENV === 'test' ? { level: 'warn' } : {}),
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
});
