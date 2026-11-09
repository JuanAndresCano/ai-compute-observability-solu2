import { defineConfig } from 'vitest/config';

// Quality gate (Impl-2 checklist): >= 90 % branch coverage on the core (domain + application) across ALL Vitest suites.
export default defineConfig({
  test: {
    globals: true,
    include: [
      'test/harness/**/*.test.ts',
      'test/schema/**/*.test.ts',
      'test/architecture/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'test/atdd/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/application/**'],
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 90 },
    },
  },
});
