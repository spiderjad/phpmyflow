import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against a running phpMyFlow (php -S) and the sample
// database from docker/sample.sql. See e2e/README.md.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PMF_URL ?? 'http://127.0.0.1:8090/',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 850 } } }],
});
