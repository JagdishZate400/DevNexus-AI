import {defineConfig} from '@playwright/test'
import base from './playwright.workspace.config.js'
export default defineConfig({...base,testMatch:['**/project-sprints.spec.js','**/features.spec.js'],grep:/sprint/i,webServer:process.env.E2E_EXTERNAL_SERVER?undefined:base.webServer})
