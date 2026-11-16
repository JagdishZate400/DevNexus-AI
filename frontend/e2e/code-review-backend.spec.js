import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'

// Real Express app and signed session: no AI provider or mail service needed.
const require = createRequire(import.meta.url)
process.env.JWT_SECRET = 'frontend-code-review-integration-test-secret'
const mailer = require('../../backend/src/services/mailer')
mailer.logEmailStatus = async () => {}
const { createApp } = require('../../backend/src/app')
const { usersByEmail } = require('../../backend/src/db/memory')
const { signToken } = require('../../backend/src/middleware/auth')
let server, backendUrl, token
test.beforeAll(async () => {
  const app = createApp()
  const user = { id: 'frontend-review-test', email: 'frontend-review@example.com', role: 'Developer', tokenVersion: 0 }
  usersByEmail.set(user.email, user)
  token = signToken(user)
  server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)) })
  backendUrl = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
})

async function setup(page) {
  await page.addInitScript((sessionToken) => {
    localStorage.setItem('ai-assistant-auth', JSON.stringify({ state: { user: { email: 'frontend-review@example.com', name: 'Test', role: 'Developer' }, token: sessionToken, rememberMe: true }, version: 0 }))
  }, token)
  await page.route('**/api/**', (route) => route.fulfill({ json: { reviews: [], projects: [] } }))
}

test('legacy numeric or malformed history findings never reach array methods', async ({ page }) => {
  await setup(page)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let findings = 3
  await page.route('**/api/reviews?*', (route) => route.fulfill({ json: { reviews: [null, { id: 'legacy-review', project: 'Legacy review', status: 'Completed', findings }] } }))
  for (const value of [3, { total: 3 }, null, undefined, [null, 7]]) {
    findings = value
    await page.goto('/code-review')
    await expect(page.getByRole('button', { name: /Legacy review/ })).toBeVisible()
    await expect(page.getByText(/No findings from these limited checks/)).toBeVisible()
    await page.getByLabel('Filter by severity').selectOption('High')
    await page.getByRole('button', { name: /Legacy review/ }).click()
    await expect(page.getByRole('heading', { name: 'Review Findings', exact: true })).toBeVisible()
  }
  await page.route('**/api/reviews', (route) => route.fulfill({ json: { review: { id: 'created-legacy', project: 'Created legacy review', status: 'Completed', findings: { total: 2 }, findingsCount: 2 } } }))
  await page.getByRole('button', { name: /start review/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /start code review/i }).click()
  await expect(page.getByRole('button', { name: /Created legacy review/ })).toBeVisible()
  await expect(page.getByText(/No findings from these limited checks/)).toBeVisible()
  expect(errors).toEqual([])
})

test('malformed analysis responses show an error and preserve usable demo fallback', async ({ page }) => {
  await setup(page)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let response
  await page.route('**/api/reviews/analyze', (route) => route.fulfill({ body: JSON.stringify(response), contentType: 'application/json' }))
  await page.goto('/code-review')
  for (const value of [null, {}, { provider: 'deterministic', findings: 3 }, { provider: 'deterministic', findings: {} }, { provider: 'deterministic', findings: [null] }]) {
    response = value
    await page.getByRole('button', { name: 'Analyze Code', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Unexpected analysis response. Try again or select Demo mode.')
    await expect(page.getByText('Login input is used before full validation.', { exact: true })).toBeVisible()
  }
  await page.getByLabel('Analysis mode').selectOption('demo')
  await page.getByRole('button', { name: 'Analyze Code', exact: true }).click()
  await expect(page.getByText(/Demo Data: Demo mode selected/)).toBeVisible()
  await page.locator('article').filter({ hasText: 'Dynamic code execution with eval.' }).getByRole('combobox').selectOption('Reviewed')
  await page.getByLabel('Filter by status').selectOption('Reviewed')
  await expect(page.getByText('Dynamic code execution with eval.', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('Analyze Code calls real Express checks and renders backend results, empty results and history', async ({ page }) => {
  await setup(page)
  let release
  const ready = new Promise((resolve) => { release = resolve })
  let first = true
  await page.route('**/api/reviews/analyze', async (route) => {
    const body = route.request().postDataJSON()
    expect(['javascript', 'typescript']).toContain(body.language)
    expect(typeof body.code).toBe('string')
    if (first) { first = false; await ready }
    const response = await page.request.post(`${backendUrl}/api/reviews/analyze`, { data: body, headers: { Authorization: `Bearer ${token}` } })
    await route.fulfill({ response })
  })
  await page.goto('/code-review')
  await page.getByRole('button', { name: 'Analyze Code', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Analyzing Code...' })).toBeDisabled()
  await expect(page.getByText('Analyzing source on the backend...', { exact: true })).toBeVisible()
  release()
  await expect(page.getByText(/Backend analysis completed with 4 findings/)).toBeVisible()
  await expect(page.getByText('Deterministic backend checks', { exact: true })).toBeVisible()
  await expect(page.getByText(/requestHandler.js.*Line 2/)).toBeVisible()
  await expect(page.getByText('Suggested fix · illustrative snippet', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'High 1', exact: true }).click()
  await expect(page.getByText('Potential HTML injection.', { exact: true })).toBeVisible()
  await page.getByLabel('Sample source code', { exact: true }).selectOption('clean')
  await page.getByRole('button', { name: 'Analyze Code', exact: true }).click()
  await expect(page.getByText(/Backend analysis completed with 0 findings/)).toBeVisible()
  await expect(page.getByText(/No findings from these limited checks/)).toBeVisible()
  await page.getByRole('button', { name: /Backend source code checks/ }).last().click()
  await page.getByLabel('Filter by severity').selectOption('All')
  await expect(page.getByText('Dynamic code execution with eval.', { exact: true })).toBeVisible()
  await page.getByLabel('Source code', { exact: true }).fill('\nvar value: number = 1')
  await page.getByLabel('Language', { exact: true }).selectOption('typescript')
  await page.getByRole('button', { name: 'Analyze Code', exact: true }).click()
  await expect(page.getByText(/Backend analysis completed with 1 findings/)).toBeVisible()
  await expect(page.getByText(/pasted-source.ts.*Line 2/)).toBeVisible()
})

test('service outage falls back with Demo Data; validation errors stay errors; explicit demo avoids API', async ({ page }) => {
  await setup(page)
  let calls = 0
  await page.route('**/api/reviews/analyze', (route) => { calls++; return route.abort() })
  await page.goto('/code-review')
  const analyze = page.getByRole('button', { name: 'Analyze Code', exact: true })
  await analyze.click()
  await expect(page.getByText(/Demo Data: Backend unavailable/)).toBeVisible()
  await page.unroute('**/api/reviews/analyze')
  await page.route('**/api/reviews/analyze', (route) => route.fulfill({ status: 503, json: { message: 'Service unavailable' } }))
  await analyze.click()
  await expect(page.getByText(/Demo Data: Backend unavailable/)).toBeVisible()
  await page.unroute('**/api/reviews/analyze')
  await page.route('**/api/reviews/analyze', (route) => route.fulfill({ status: 400, json: { message: 'Validation failed', errors: [{ field: 'code', message: 'Invalid source for test' }] } }))
  await analyze.click()
  await expect(page.getByRole('alert')).toHaveText('Invalid source for test')
  await expect(page.getByText(/Demo Data: Backend unavailable/)).toHaveCount(0)
  await page.getByLabel('Analysis mode').selectOption('demo')
  await analyze.click()
  await expect(page.getByText(/Demo Data: Demo mode selected/)).toBeVisible()
  expect(calls).toBe(1)
})
