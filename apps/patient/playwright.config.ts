import { defineConfig } from '@playwright/test'

const port = Number(process.env.PATIENT_STATIC_PORT || '4173')
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', channel: process.env.PATIENT_BROWSER_CHANNEL,
    serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/serve-static.mjs', url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false, timeout: 10_000 },
})
