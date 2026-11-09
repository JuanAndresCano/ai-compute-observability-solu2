import { defineConfig, devices } from '@playwright/test';

const PORT = 4311;

/**
 * Flow E (Playwright E2E, Story 11.6). Forensic traces: the first retry of a failing test records a trace.zip
 * (DOM snapshots, network, console, actions) under test-results/. CI runs with retries=1 so a failure always yields one.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1, // the console keeps fleet state in memory: one server, one worker, deterministic scenarios
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && node dist/src/server.js',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'production', DB_PATH: ':memory:', SEED_DEMO_LOGS: 'true' },
  },
});
