import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Fresh auth state: clear storage before any app code reads it.
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.reload()
})

test('unauthenticated user is redirected to login', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
})

test('login flow reaches dashboard (backend fallback)', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('e2e@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123!')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })
})

test('landing page introduces the product and links to login', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /ship better code/i })).toBeVisible()
  await page.getByRole('link', { name: /^sign in$/i }).first().click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('link', { name: /back to home/i })).toBeVisible()
})

test('register validation blocks empty submit', async ({ page }) => {
  await page.goto('/register')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page.getByText(/full name is required/i)).toBeVisible()
})
