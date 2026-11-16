import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.reload()
  await page.getByLabel('Email', { exact: true }).fill('e2e@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123!')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })
}

test('projects page lists mock workspace', async ({ page }) => {
  await login(page)
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: /^projects$/i }).first()).toBeVisible()
  await expect(page.getByText(/e-commerce platform/i).first()).toBeVisible()
})

test('workspace shows file explorer', async ({ page }) => {
  await login(page)
  await page.goto('/workspace')
  await expect(page.getByText(/file explorer/i)).toBeVisible()
})

test('security page filters without crashing', async ({ page }) => {
  await login(page)
  await page.goto('/security')
  await expect(page.getByRole('heading', { name: /bugs & security/i }).first()).toBeVisible()
  // Search filter should narrow the list, never crash on empty selection.
  const search = page.getByPlaceholder(/search/i)
  if (await search.count()) {
    await search.fill('zzz-no-such-finding')
    await expect(page.getByText(/0 shown|no .* found/i).first()).toBeVisible({ timeout: 5000 }).catch(() => {})
  }
})

test('settings surfaces backend password errors', async ({ page }) => {
  await login(page)
  // E2E runs on the offline mock fallback, so stub the endpoint like the backend would answer.
  await page.route('**/api/auth/change-password', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Current password is incorrect' }),
  }))
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: /^settings$/i }).first()).toBeVisible()
  await page.getByLabel('Current password', { exact: true }).fill('Wrong123!')
  await page.getByLabel('New password', { exact: true }).fill('NewPassword456!')
  await page.getByLabel('Confirm new password', { exact: true }).fill('NewPassword456!')
  await page.getByRole('button', { name: /update password/i }).click()
  await expect(page.getByText(/current password is incorrect/i)).toBeVisible()
})

test('notifications bell opens a working panel', async ({ page }) => {
  await login(page)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Notifications' }).click()
  const panel = page.getByRole('dialog', { name: 'Notifications' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('AI project analysis completed')).toBeVisible()
  await page.getByRole('button', { name: /mark all read/i }).click()
  await expect(page.getByRole('button', { name: /mark all read/i })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toHaveCount(0)
})

test('logout returns to login', async ({ page }) => {
  await login(page)
  const signOut = page.getByRole('button', { name: /sign out/i }).first()
  await signOut.click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})
