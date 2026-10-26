import { defineConfig } from 'vitest/config';

// Red-phase ATDD suite: every test must fail with NotImplementedError until the production code exists.
export default defineConfig({
  test: {
    globals: true,
    include: ['test/atdd/**/*.test.ts'],
    testTimeout: 30_000,
    passWithNoTests: false,
  },
});
