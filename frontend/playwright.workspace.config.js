import base from './playwright.config.js'
import { defineConfig } from '@playwright/test'

// Focused regressions can use an installed browser (Chrome/Edge) without downloading binaries.
export default defineConfig({
  ...base,
  testMatch: '**/workspace*.spec.js',
  workers: 1,
  projects: [
    {
      name: 'workspace',
      use: {
        ...base.projects[0].use,
        channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
      },
    },
  ],
})
