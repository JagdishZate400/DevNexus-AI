import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.reload()
  // Mock fallback session signs in as a Developer.
  await page.getByLabel('Email', { exact: true }).fill('e2e@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123!')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })
}

test('team directory exposes management for authenticated project owners',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{id:'owner',email:'owner@example.test',role:'Developer'},token:'directory-test-token',rememberMe:true},version:0})))
  await page.route('**/api/**',r=>r.fulfill({json:{user:{id:'owner',email:'owner@example.test',role:'Developer'}}}))
  await page.route('**/api/project-members/projects',r=>r.fulfill({json:{projects:[{id:'owned',name:'Owned project',ownerId:'owner',access:'owner'}]}}))
  await page.route('**/api/project-members?*',r=>r.fulfill({json:{projectId:'owned',owner:{userId:'owner',displayName:'Project Owner',email:'owner@example.test'},members:[],total:0,limit:20,offset:0}}))
  await page.goto('/team')
  await expect(page.getByRole('region',{name:'Project owner'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Add member',exact:true})).toBeVisible()
  await expect(page.getByText('Members can view their project team and task list. Source, AI, documents, sprints, comments and activity remain owner-only.')).toBeVisible()
})

test('user roles panel hides for developers', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: /^settings$/i }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: /user roles/i })).toHaveCount(0)
})
