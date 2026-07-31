import { defineConfig } from '@playwright/test';

const port = Number(process.env.HELM_E2E_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(
    'HELM_E2E_PORT must be an allocated TCP port. Run Playwright through scripts/run-playwright.mjs.',
  );
}

const baseURL = `http://127.0.0.1:${port}/helm/`;
const isCi = Boolean(process.env.CI);
const useHostedChrome = process.env.HELM_E2E_USE_HOST_CHROME === '1';
const runId = process.env.HELM_E2E_RUN_ID || String(port);

export default defineConfig({
  testDir: './e2e',
  outputDir: `test-results/playwright/${runId}`,
  timeout: 30_000,
  retries: isCi ? 1 : 0,
  failOnFlakyTests: isCi,
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    timezoneId: 'Europe/London',
  },
  webServer: {
    command: `npm exec vite -- --host 127.0.0.1 --port ${port} --strictPort`,
    env: {
      VITE_SUPABASE_PUBLISHABLE_KEY: 'helm-test-publishable-key',
      VITE_SUPABASE_URL: 'https://helm.test.supabase.co',
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        channel: useHostedChrome ? 'chrome' : undefined,
      },
    },
  ],
});
