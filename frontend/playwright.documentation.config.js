import {defineConfig} from '@playwright/test'
import base from './playwright.workspace.config.js'
export default defineConfig({...base,testMatch:['**/documentation-foundation.spec.js','**/documentation-d3c.spec.js','**/documentation-pdf.spec.js','**/features.spec.js'],grep:/documentation/i,webServer:process.env.E2E_EXTERNAL_SERVER ? undefined : base.webServer})
