import { test, expect } from '@playwright/test'

const user = { id: 'test-user', email: 'workspace@example.com', name: 'Workspace User', role: 'Developer' }
const token = 'regression-access-token'
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('workspace-regression-initialized')) { localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('workspace-regression-initialized', '1') } })
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }))
})
async function login(page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('Test-password123!')
  await page.getByRole('button', { name: /^sign in$/i }).click()
}
async function sessionRoutes(page) {
  await page.route('**/api/auth/login', (route) => route.fulfill({ json: { user, token, refreshToken: 'refresh-fixture' } }))
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }))
}

test('network/CORS login failure cannot create a mock session', async ({ page }) => {
  await page.route('**/api/auth/login', (route) => route.abort('failed'))
  await login(page)
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('alert')).toContainText('Cannot reach the server')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ai-assistant-auth')).state.token)).toBeNull()
})

test('real login sends Bearer token and Workspace distinguishes an empty project list', async ({ page }) => {
  await sessionRoutes(page)
  let authorized = false
  await page.route('**/api/workspace/projects', (route) => {
    authorized = route.request().headers().authorization === `Bearer ${token}`
    return route.fulfill({ json: { projects: [] } })
  })
  await login(page)
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/workspace')
  await expect(page.getByText('Create a project in Projects first', { exact: false })).toBeVisible()
  expect(authorized).toBe(true)
  await expect(page.getByText('Sign in to upload and browse your project source.')).toHaveCount(0)
})

test('Workspace displays storage failure separately from authentication and empty projects', async ({ page }) => {
  await sessionRoutes(page)
  await page.route('**/api/workspace/projects', (route) => route.fulfill({ status: 503, json: { message: 'Source storage is unavailable.' } }))
  await login(page)
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/workspace')
  await expect(page.getByRole('alert')).toHaveText('Source storage is unavailable.')
  await expect(page.getByText('Create a project in Projects first', { exact: false })).toHaveCount(0)
})

test('persisted legacy mock session cannot enter protected Workspace', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ai-assistant-auth', JSON.stringify({ state: { token: 'mock.legacy', user: { email: 'legacy@example.com' }, rememberMe: true }, version: 0 })))
  await page.goto('/workspace')
  await expect(page).toHaveURL(/\/login/)
})

test('remembered real session hydrates and loads owned projects with its Bearer token', async ({ page }) => {
  await page.addInitScript(({ user, token }) => localStorage.setItem('ai-assistant-auth', JSON.stringify({ state: { user, token, rememberMe: true }, version: 0 })), { user, token })
  await sessionRoutes(page)
  await page.route('**/api/workspace/projects', (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`)
    return route.fulfill({ json: { projects: [{ id: 'owned-project', name: 'Owned project' }] } })
  })
  await page.route('**/api/workspace/projects/owned-project/files', (route) => route.fulfill({ json: { files: [] } }))
  await page.goto('/workspace')
  await expect(page.getByLabel('Project', { exact: true })).toHaveValue('owned-project')
  await expect(page.getByText('No source files uploaded yet.')).toBeVisible()
})

test('expired Workspace token refreshes once and retries with the new Bearer token', async ({ page }) => {
  await sessionRoutes(page)
  let refreshCalls = 0, attempts = 0
  await page.route('**/api/auth/refresh', (route) => {
    refreshCalls++
    return route.fulfill({ json: { user, token: 'renewed-access-token', refreshToken: 'renewed-refresh-token' } })
  })
  await page.route('**/api/workspace/projects', (route) => {
    attempts++
    const fresh = route.request().headers().authorization === 'Bearer renewed-access-token'
    return route.fulfill({ status: fresh ? 200 : 401, json: fresh ? { projects: [] } : { message: 'Expired token' } })
  })
  await login(page)
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/workspace')
  await expect(page.getByText('Create a project in Projects first', { exact: false })).toBeVisible()
  expect(refreshCalls).toBe(1)
  expect(attempts).toBeGreaterThanOrEqual(2)
})
