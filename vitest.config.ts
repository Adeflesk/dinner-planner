import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Several test files spin up a fresh in-memory PGlite (WASM Postgres) instance
    // per test. Too many starting at once (one per worker, up to CPU count) contend
    // for CPU and can blow the default 5s timeout under load. Capping concurrency
    // fixes the contention at its source; the raised timeout is a safety margin on
    // top, not a substitute — both are needed for a reliably green `npm test`.
    testTimeout: 15000,
    poolOptions: {
      threads: { maxThreads: 4 },
      forks: { maxForks: 4 },
    },
  },
});
