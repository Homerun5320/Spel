import { defineConfig } from 'vitest/config';

// Three projects: unit (fast, pure), perf (CPU budgets, strictly serial), e2e (headless Chromium).
// verify runs them as separate invocations, never a bare `vitest run`.
export default defineConfig({
  test: {
    // Show console output of passing tests too: perfguard factor, retries and shot metrics are logged on purpose.
    silent: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts', 'tools/**/*.test.ts'],
          exclude: ['tests/**/*.perf.test.ts', 'node_modules/**'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'perf',
          include: ['tests/**/*.perf.test.ts'],
          environment: 'node',
          pool: 'forks',
          fileParallelism: false,
          maxWorkers: 1,
          // retry: 1 is allowed in the perf project only; the setup file logs it.
          retry: 1,
          setupFiles: ['tests/perf.setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['e2e/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['e2e/globalSetup.ts'],
          pool: 'forks',
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
