import {defineConfig} from '@playwright/test'
import base from './playwright.workspace.config.js'
export default defineConfig({...base,testMatch:['**/project-members.spec.js','**/authz.spec.js'],grep:/directory/i,webServer:process.env.E2E_EXTERNAL_SERVER?undefined:base.webServer})
