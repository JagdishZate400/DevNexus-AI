import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.reload()
  // Offline mock fallback session (Developer).
  await page.getByLabel('Email', { exact: true }).fill('e2e@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123!')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })
}

async function mockDurableTasks(page) {
  const tasks=[]
  await page.addInitScript(()=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'tasks@example.test',role:'Developer'},token:'tasks-test-token',rememberMe:true},version:0})))
  await page.route('**/api/**',route=>route.fulfill({json:{user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'tasks@example.test',role:'Developer'}}}))
  await page.route('**/api/workspace/projects',route=>route.fulfill({json:{projects:[{id:'owned-tasks',name:'DevNexus Test Project'}]}}))
  await page.route('**/api/project-members?*',route=>route.fulfill({json:{projectId:'owned-tasks',owner:{userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',displayName:'Owner',email:'tasks@example.test'},members:[],total:0,limit:20,offset:0}}))
  await page.route('**/api/project-tasks**',route=>{
    if(route.request().method()==='POST'){const task={id:'11111111-1111-4111-8111-111111111111',status:'To Do',assigneeUserId:null,assignee:null,sprintId:null,...route.request().postDataJSON()};tasks.push(task);return route.fulfill({status:201,json:{task}})}
    return route.fulfill({json:{tasks,total:tasks.length,limit:20,offset:0}})
  })
}
test('tasks create flow uses the durable project API', async ({ page }) => {
  await mockDurableTasks(page);await page.goto('/tasks')
  await page.getByRole('button',{name:'New Task',exact:true}).click()
  await page.getByLabel('Title',{exact:true}).fill('Wire tasks to backend')
  await page.getByLabel('Description',{exact:true}).fill('Saved by the durable API.')
  await page.getByRole('button',{name:'Create task',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Wire tasks to backend',exact:true})).toBeVisible()
})
test('tasks validation blocks empty submit', async ({ page }) => {
  await mockDurableTasks(page);await page.goto('/tasks')
  await page.getByRole('button',{name:'New Task',exact:true}).click()
  await page.getByRole('button',{name:'Create task',exact:true}).click()
  await expect(page.getByText('Title is required.',{exact:true})).toBeVisible()
})

test('sprints create flow uses durable project API', async ({page})=>{
  await mockDurableTasks(page)
  const sprints=[]
  await page.route('**/api/project-sprints**',route=>{
    if(route.request().method()==='POST'){
      const sprint={id:'11111111-1111-4111-8111-111111111111',...route.request().postDataJSON(),counts:{toDo:0,inProgress:0,done:0,total:0},empty:true,progress:null}
      sprints.unshift(sprint);return route.fulfill({status:201,json:{sprint}})
    }
    return route.fulfill({json:{sprints,total:sprints.length,limit:20,offset:0}})
  })
  await page.goto('/sprints');await page.getByRole('button',{name:'New Sprint',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByLabel('Sprint name',{exact:true}).fill('Sprint 99')
  await dialog.getByLabel('Start date').fill('2026-10-01');await dialog.getByLabel('End date').fill('2026-10-14')
  await dialog.getByRole('button',{name:'Create sprint',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Sprint 99',exact:true})).toBeVisible()
})

test('ai chat answers offline', async ({ page }) => {
  await login(page)
  await page.goto('/ai-chat')
  await expect(page.getByRole('heading', { name: /ai chat/i }).first()).toBeVisible()
  await page.getByPlaceholder(/ask about your project/i).fill('Where is authentication implemented?')
  await page.getByRole('button', { name: /^send$/i }).click()
  await expect(page.getByText('Where is authentication implemented?').first()).toBeVisible({ timeout: 10_000 })
})

test('code review starts offline', async ({ page }) => {
  await login(page)
  await page.goto('/code-review')
  await page.getByRole('button', { name: /start review/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /start code review/i }).click()
  await expect(page.getByText(/just now/i).first()).toBeVisible({ timeout: 10_000 })
})

test('documentation setup disables offline generation without legacy API calls', async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{email:'docs@example.com',role:'Developer'},token:'docs-test-token',rememberMe:true},version:0})))
  await page.route('**/api/**',r=>r.fulfill({json:{user:{email:'docs@example.com',role:'Developer'}}}))
  await page.route('**/api/workspace/projects',r=>r.fulfill({json:{projects:[]}}))
  await page.goto('/documentation')
  await page.getByRole('button',{name:'Documentation Setup',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('button',{name:'Generate Documentation',exact:true})).toBeDisabled()
  await expect(page.getByText(/mock generated documentation/i)).toHaveCount(0)
})

test('global search navigates to tasks', async ({ page }) => {
  await mockDurableTasks(page)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /^search$/i }).click()
  await page.getByRole('textbox', { name: /search workspace/i }).fill('tasks')
  await page.getByRole('button', { name: /tasks.*go to page/i }).click()
  await expect(page).toHaveURL(/\/tasks/)
})

test('project card actions menu archives and deletes', async ({ page }) => {
  await login(page)
  await page.goto('/projects')
  await page.getByRole('button', { name: /more actions for e-commerce platform/i }).click()
  await page.getByRole('button', { name: /^archive$/i }).click()
  await expect(page.getByText(/archived/i).first()).toBeVisible()
  await page.getByRole('button', { name: /more actions for task management system/i }).click()
  await page.getByRole('button', { name: /^delete$/i }).click()
  await page.getByRole('button', { name: /confirm delete/i }).click()
  await expect(page.getByText('Task Management System')).toHaveCount(0)
})

test('reports require persisted ownership and do not generate demo snapshots offline', async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{email:'owner@reports.test',role:'Developer'},token:'reports-fixture-token',rememberMe:true},version:0})))
  await page.route('**/api/**',r=>r.fulfill({json:{user:{email:'owner@reports.test',role:'Developer'}}}))
  await page.route('**/api/reports/projects',r=>r.fulfill({json:{projects:[]}}))
  await page.goto('/reports')
  await expect(page.getByText('No owned persisted projects.',{exact:false})).toBeVisible()
  await expect(page.getByRole('button',{name:/Generate report/i})).toHaveCount(0)
  await expect(page.getByText('Weekly engineering digest')).toHaveCount(0)
})
