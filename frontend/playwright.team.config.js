import {defineConfig} from '@playwright/test'
import base from './playwright.workspace.config.js'
export default defineConfig({...base,testMatch:['**/team-collaboration.spec.js','**/project-members.spec.js','**/task-assignment.spec.js','**/task-assignment-components.spec.js','**/project-tasks.spec.js','**/project-sprints.spec.js'],webServer:process.env.E2E_EXTERNAL_SERVER?undefined:base.webServer})
