import os from 'node:os';
import { defineConfig } from 'vitest/config';
import { e2eWorkerCount } from './scripts/localGpu.mjs';

// e2e workers (docs/DECISIONS.md D144): E2E_WORKERS wins; with LOCAL_GPU=1 floor(cores / 2) up to 4; otherwise cores - 1 up to 3.
// Measured on 4 cores: 3 workers passed 3 of 3 verify runs in 7:39 to 7:53, 2 workers 5 of 5 in 8:07 to 8:34; one worker needed 605 s for the
// e2e project alone. More Chromium instances only slow every frame down: SwiftShader already uses several cores per frame. The tests that
// measure memory or time live in `*.serial.test.ts` files (plus e2e/heap.test.ts) and run alone in the e2e-serial project, one file at a time.
const E2E_DEFAULT_WORKERS = Math.max(1, Math.min(3, os.availableParallelism() - 1));
/** The files of the e2e-serial project: every `*.serial.test.ts` plus the heap self-test (its name is pinned by tests/rawHeap.test.ts). */
const E2E_SERIAL_FILES = ['e2e/**/*.serial.test.ts', 'e2e/heap.test.ts'];
const e2eWorkers = e2eWorkerCount(process.env, os.availableParallelism(), E2E_DEFAULT_WORKERS);

// Four projects: unit (fast, pure), perf (CPU budgets, strictly serial), e2e (headless Chromium, a few files at a time), e2e-serial (Chromium, memory and time tests, one at a time).
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
          // All cores (the default is cores - 1): the unit project is CPU-bound and nothing else runs next to it except typecheck and lint (D144).
          maxWorkers: os.availableParallelism(),
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
          exclude: [...E2E_SERIAL_FILES, 'node_modules/**'],
          environment: 'node',
          globalSetup: ['e2e/globalSetup.ts'],
          pool: 'forks',
          fileParallelism: e2eWorkers > 1,
          maxWorkers: e2eWorkers,
          // Two Chromium instances share the CPU, so every frame takes longer: the per-test limit grows with the worker count. The 20 s hang
          // guard of every browser call (scripts/shot.mjs) is unchanged and still catches a real hang.
          testTimeout: e2eWorkers > 1 ? 120_000 : 60_000,
          hookTimeout: e2eWorkers > 1 ? 120_000 : 60_000,
        },
      },
      {
        // Heap, leak and wall-clock budget tests: one file at a time, alone in the machine (never next to the parallel e2e project or perf).
        test: {
          name: 'e2e-serial',
          include: E2E_SERIAL_FILES,
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
