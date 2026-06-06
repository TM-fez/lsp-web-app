import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['dotenv/config'],
    // Default run: everything EXCEPT tests that require a live PostgreSQL
    // instance. Those tests document their requirement at the top of each file
    // ("Requires a running PostgreSQL instance with migrations applied.").
    // Run them with:  npx vitest run --config vitest.live.config.ts
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/integration/auth.test.ts',
      'tests/integration/dashboard.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/db/migrations/**', 'src/db/seeds/**'],
    },
  },
});

