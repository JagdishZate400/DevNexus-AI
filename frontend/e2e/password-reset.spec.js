import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.reload()
})

test('login links to forgot password', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: /forgot password/i }).click()
  await expect(page).toHaveURL(/\/forgot-password/)
  await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible()
})

test('forgot password validates empty submit', async ({ page }) => {
  await page.goto('/forgot-password')
  await page.getByRole('button', { name: /send reset link/i }).click()
  await expect(page.getByText(/email is required/i)).toBeVisible()
})

test('reset password without token guides to a new link', async ({ page }) => {
  await page.goto('/reset-password')
  await expect(page.getByText(/missing its token/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /request a new link/i })).toBeVisible()
})

test('reset password validates weak input', async ({ page }) => {
  await page.goto('/reset-password?token=abc123')
  await page.getByRole('button', { name: /update password/i }).click()
  await expect(page.getByText(/password is required/i).first()).toBeVisible()
})
