import { defineConfig } from 'vitest/config';

// Green suites: they test the test doubles, the physical schema constraints and the architecture rules.
export default defineConfig({
  test: {
    globals: true,
    include: ['test/harness/**/*.test.ts', 'test/schema/**/*.test.ts', 'test/architecture/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/adapters/sim/**', 'test/fixtures/**'], reporter: ['text'] },
  },
});
