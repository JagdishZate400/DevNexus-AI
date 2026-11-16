import {defineConfig} from '@playwright/test'
import base from './playwright.workspace.config.js'
export default defineConfig({...base,testMatch:'**/security-projects.spec.js',webServer:process.env.E2E_EXTERNAL_SERVER ? undefined : base.webServer})
