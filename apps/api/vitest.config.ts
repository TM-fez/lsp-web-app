import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['dotenv/config'],
    // Default run: everything EXCEPT tests that require a live PostgreSQL
    // instance. Those tests document their requirement at the top of each file
    // ("Requires a running PostgreSQL instance with migrations applied.").
    // Live-DB suites run via their own configs:
    //   auth/dashboard:  npx vitest run --config vitest.live.config.ts
    //   cockpit E2E:     npx vitest run --config vitest.e2e.config.ts (needs a migrated DB)
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/integration/auth.test.ts',
      'tests/integration/dashboard.test.ts',
      'tests/e2e/**',
      // Real Postgres required: it inserts BLOCKED/BOOKING_COM rows the API forbids, so it
      // proves the SQL export filter against actual data. Runs in the live-DB suite, not the
      // no-DB default run — see vitest.live.config.ts.
      'tests/integration/modules/channel-export.test.ts',
      // Real Postgres required: it installs a trigger that fails audit_logs inserts and
      // asserts the money row rolls back with them, which only means anything against a
      // real transaction. Runs in the live-DB suite — see vitest.live.config.ts.
      'tests/integration/modules/audit-atomicity.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/db/migrations/**', 'src/db/seeds/**'],
    },
  },
});

