import { defineConfig, devices } from '@playwright/test'

// E2E_PORT overrides the dev-server port when 5174 is taken by another app
// on the machine (the runner reuses an existing server when present).
const port = Number(process.env.E2E_PORT || 5174)

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.E2E_PORT,
    timeout: 60 * 1000,
  },
})
