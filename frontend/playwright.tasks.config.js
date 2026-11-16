import {defineConfig} from '@playwright/test'
import base from './playwright.workspace.config.js'
export default defineConfig({...base,testMatch:['**/project-tasks.spec.js','**/features.spec.js'],grep:/tasks|task validation/i,webServer:process.env.E2E_EXTERNAL_SERVER ? undefined : base.webServer})
