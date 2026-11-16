import {test,expect} from '@playwright/test'
const me='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const projects=[{id:'owned',name:'My durable project',ownerId:me,access:'owner'},{id:'shared',name:'Shared durable project',ownerId:other,access:'member'}]
const person={id:'membership',projectId:'shared',userId:me,displayName:'Registered Member',email:'member@test.example',displayRole:'Viewer'}
const task=i=>({id:`task-${i}`,projectId:'shared',title:`Shared task ${i}`,description:'Saved description',status:'To Do',priority:'Medium',sprintId:null,assigneeUserId:null,assignee:null})
async function setup(page){
 const state={revoked:false,fail:false,calls:[]}
 await page.addInitScript(me=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{id:me,email:'member@test.example',role:'Developer'},token:'team-token',rememberMe:true},version:0})),me)
 await page.route('**/api/**',r=>{state.calls.push(r.request().url());return r.fulfill({status:500,json:{message:'Unexpected API request'}})})
 await page.route('**/api/auth/me',r=>r.fulfill({json:{user:{id:me,email:'member@test.example',role:'Developer'}}}))
 await page.route('**/api/project-members/projects',r=>r.fulfill(state.fail?{status:503,json:{message:'Team storage unavailable'}}:{json:{projects:state.revoked?projects.slice(0,1):projects}}))
 await page.route('**/api/project-members?*',r=>r.fulfill({json:{projectId:'owned',owner:{userId:me,displayName:'Me',email:'member@test.example'},members:[],total:0,limit:20,offset:0}}))
 await page.route('**/api/project-members/directory?*',r=>{
  state.calls.push(r.request().url());const offset=Number(new URL(r.request().url()).searchParams.get('offset'))
  return r.fulfill(state.revoked?{status:404,json:{message:'Project or membership not found.'}}:{json:{projectId:'shared',owner:{userId:other,displayName:'Project Owner',email:'owner@test.example'},members:offset?[]:[person],total:1,limit:20,offset}})
 })
 await page.route('**/api/project-tasks?*',r=>r.fulfill({json:{tasks:[],total:0,limit:20,offset:0}}))
 await page.route('**/api/project-tasks/visible?*',r=>{
  state.calls.push(r.request().url());const offset=Number(new URL(r.request().url()).searchParams.get('offset'))
  return r.fulfill(state.revoked?{status:404,json:{message:'Project or membership not found.'}}:{json:{tasks:Array.from({length:21},(_,i)=>task(i)).slice(offset,offset+20),total:21,limit:20,offset}})
 })
 return state
}
test('Team distinguishes durable owned/member projects and hides member management',async({page})=>{
 const state=await setup(page);await page.goto('/team')
 const select=page.getByLabel('Team project')
 await expect(select.locator('optgroup[label="Owned Projects"] option')).toHaveText(['My durable project'])
 await expect(select.locator('optgroup[label="Member Projects"] option')).toHaveText(['Shared durable project'])
 await expect(page.getByLabel('Registered member email')).toHaveAttribute('maxlength','254')
 await select.selectOption('shared')
 await expect(page.getByRole('region',{name:'Project members'})).toContainText('Registered Member')
 await expect(page.getByText('Member Project: read-only team access')).toBeVisible()
 for(const name of ['Add member','Save role','Remove member'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0)
 expect(state.calls.some(url=>url.includes('/workspace/'))).toBe(false)
})
test('member task list is read-only, paginates and never opens private Details streams',async({page})=>{
 const state=await setup(page);await page.goto('/tasks');await page.getByLabel('Tasks project').selectOption('shared')
 await expect(page.getByRole('article',{name:'Task: Shared task 0',exact:true})).toBeVisible()
 for(const name of ['New Task','Advance','Edit','Delete','View details'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0)
 await expect(page.getByRole('combobox',{name:/Status for/})).toHaveCount(0)
 await page.getByRole('button',{name:'Next tasks',exact:true}).click()
 await expect(page.getByRole('article',{name:'Task: Shared task 20',exact:true})).toBeVisible()
 await expect(page.getByRole('article',{name:'Task: Shared task 0',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Previous tasks',exact:true}).click()
 await expect(page.getByRole('article',{name:'Task: Shared task 0',exact:true})).toBeVisible()
 expect(state.calls.some(url=>/\/comments|\/activity|\/workspace|\/sprints/.test(url))).toBe(false)
 await page.getByLabel('Tasks project').selectOption('owned')
 await expect(page.getByRole('button',{name:'New Task',exact:true})).toBeVisible()
 await expect(page.getByText('Shared task 0',{exact:true})).toHaveCount(0)
})
for(const route of ['/team','/tasks'])test(`membership revocation clears ${route} content on the next read`,async({page})=>{
 const state=await setup(page);await page.goto(route);await page.getByLabel(route==='/team'?'Team project':'Tasks project').selectOption('shared')
 await expect(page.getByText(route==='/team'?'Registered Member':'Shared task 0',{exact:true})).toBeVisible()
 state.revoked=true
 await page.getByRole('button',{name:route==='/team'?'Refresh directory':'Refresh tasks',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Project or membership not found')
 await expect(page.getByText(route==='/team'?'Registered Member':'Shared task 0',{exact:true})).toHaveCount(0)
})
test('Team discovery handles storage failure and keyboard recovery',async({page})=>{
 const state=await setup(page);state.fail=true;await page.goto('/team')
 await expect(page.getByRole('alert')).toContainText('Team storage unavailable')
 state.fail=false;await page.getByRole('button',{name:'Retry projects',exact:true}).focus();await page.keyboard.press('Enter')
 await expect(page.getByRole('region',{name:'Project owner'})).toBeVisible()
 const select=page.getByLabel('Team project');await select.focus();await page.keyboard.press('End');await page.keyboard.press('Enter')
 await expect(page.getByRole('region',{name:'Project members'})).toContainText('Registered Member')
 await page.getByLabel('Search members on this page').fill('absent')
 await expect(page.getByText('No members match the current page filters')).toBeVisible()
 await page.getByRole('button',{name:'Clear filters',exact:true}).focus();await page.keyboard.press('Enter')
 await expect(page.getByRole('region',{name:'Project members'})).toContainText('Registered Member')
})
for(const route of ['/team','/tasks'])test(`${route} discards delayed member data on project and account changes`,async({page})=>{
 await setup(page);let held
 const endpoint=route==='/team'?'project-members/directory':'project-tasks/visible'
 await page.route(`**/api/${endpoint}?*`,async r=>{await new Promise(resolve=>held=resolve);await r.fallback()})
 await page.goto(route);const select=page.getByLabel(route==='/team'?'Team project':'Tasks project')
 await select.selectOption('shared');await expect.poll(()=>!!held).toBe(true)
 await select.selectOption('owned');held()
 await expect(page.getByText(route==='/team'?'Registered Member':'Shared task 0',{exact:true})).toHaveCount(0)
 held=null;await select.selectOption('shared');await expect.poll(()=>!!held).toBe(true)
 await page.route('**/api/project-members/projects',r=>r.fulfill({json:{projects:[]}}))
 await page.evaluate(async()=>{const {useAuthStore}=await import('/src/store/authStore.js');useAuthStore.setState({user:{id:'other-account',email:'other@test.example'},token:'other-team-token'})})
 held()
 await expect(page.getByText('No Team projects found.',{exact:false})).toBeVisible()
 await expect(page.getByText(route==='/team'?'Registered Member':'Shared task 0',{exact:true})).toHaveCount(0)
})
test('uncertain owner addition is not replayed and requires directory refresh',async({page})=>{
 await setup(page);let posts=0
 await page.route('**/api/project-members',r=>{posts++;return r.abort('failed')})
 await page.goto('/team');await page.getByLabel('Registered member email').fill('registered@test.example')
 await page.getByRole('button',{name:'Add member',exact:true}).evaluate(button=>{button.click();button.click()})
 await expect(page.getByRole('alert')).toContainText('No automatic retry was made')
 await expect(page.getByRole('button',{name:'Add member',exact:true})).toBeDisabled();expect(posts).toBe(1)
 await page.getByRole('button',{name:'Refresh directory',exact:true}).click()
 await expect(page.getByRole('button',{name:'Add member',exact:true})).toBeEnabled();expect(posts).toBe(1)
})
