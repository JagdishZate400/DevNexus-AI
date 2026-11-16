import {defineConfig} from '@playwright/test'
import base from './playwright.workspace.config.js'
export default defineConfig({...base,testMatch:'**/repository-review.spec.js',webServer:process.env.E2E_EXTERNAL_SERVER ? undefined : base.webServer})
