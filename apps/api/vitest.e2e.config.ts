/**
 * Sprint 9 — Operations Cockpit end-to-end config (LIVE DB).
 *
 * Boot a Postgres, migrate + seed it, then:
 *   DATABASE_URL=... npx vitest run --config vitest.e2e.config.ts
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['dotenv/config'],
    include: ['tests/e2e/**/*.test.ts'],
    // The login + many writes can be throttled by the prod auth limiter; relax
    // it for this run only (matches the live-DB suite convention).
    env: { RATE_LIMIT_AUTH_MAX: '1000' },
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
