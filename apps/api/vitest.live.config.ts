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
    ],
    // Give live-DB tests more time — DB setup can be slow
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
