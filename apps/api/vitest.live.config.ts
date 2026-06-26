/**
 * Vitest configuration for LIVE-DB integration tests.
 *
 * Prerequisites:
 *   docker compose -f infra/docker-compose.test.yml up -d
 *   DATABASE_URL=postgresql://lsp:lsp@localhost:5433/lsp_test npm run db:migrate
 *
 * Run with:
 *   DATABASE_URL=postgresql://lsp:lsp@localhost:5433/lsp_test \
 *     npx vitest run --config vitest.live.config.ts
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['dotenv/config'],
    include: [
      'tests/integration/auth.test.ts',
      'tests/integration/dashboard.test.ts',
      // Proves the per-unit iCal export filter: a Booking.com-sourced BLOCKED row must
      // never appear in the feed (no OTA feedback loop).
      'tests/integration/modules/channel-export.test.ts',
    ],
    // The auth suite issues ~18 logins; the production auth rate limit
    // (RATE_LIMIT_AUTH_MAX=10/min) throttles the later ones (429), which made
    // logout / me / logout-all fail (no cookie / 401). Relax it for the live-DB
    // test run ONLY — application behaviour in dev/prod is unchanged. Set before
    // dotenv/config runs, which does not override already-present vars.
    env: {
      RATE_LIMIT_AUTH_MAX: '1000',
    },
    // Give live-DB tests more time — DB setup can be slow
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
