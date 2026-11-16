import {test,expect} from '@playwright/test'
const taskId='11111111-1111-4111-8111-111111111111',ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const task={id:taskId,projectId:'owned',title:'Inspect durable task',description:'Saved task',status:'To Do',priority:'Medium',sprintId:null,assigneeUserId:null,assignee:null}
const comment=(n=1,body='Saved plain text')=>({id:`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`,taskId,author:{userId:ownerId,displayName:'Registered Owner'},body,createdAt:'2026-10-16T00:00:00.000Z',position:String(n),clientRequestId:'33333333-3333-4333-8333-333333333333'})
const activity=n=>({id:String(n),taskId,actor:n%2?null:{userId:ownerId,displayName:'Registered Owner'},eventType:'status_changed',origin:n%2?'database':'api',reason:n%2?'unknown':'task_updated',changes:{version:1,from:'To Do',to:'Done'},occurredAt:'2026-10-16T00:00:00.000Z',correlationId:null})
const cursor=(stream,before)=>Buffer.from(JSON.stringify({v:1,taskId,stream,before})).toString('base64url')
const feed=(stream,items=[],more=false)=>({taskId,[stream]:items,limit:20,nextCursor:more?cursor(stream,stream==='comments'?items.at(-1).position:items.at(-1).id):null,hasMore:more})
async function mocks(page){
 await page.route('**/api/**',r=>r.fulfill({json:{user:{id:ownerId,email:'owner@test',role:'Developer'}}}))
 await page.route('**/api/project-tasks/*/comments?*',r=>r.fulfill({json:feed('comments')}))
 await page.route('**/api/project-tasks/*/activity?*',r=>r.fulfill({json:feed('activity')}))
}
async function mount(page,props={}){
 await page.goto('/e2e/fixtures/task-details.html');await page.waitForFunction(()=>window.renderDetails)
 await page.evaluate(props=>window.renderDetails(props),{task,...props})
}
test('comment uncertain retry keeps UUID and body, blocks duplicates, renders escaped text',async({page})=>{
 await mocks(page);const calls=[]
 await page.route('**/api/project-tasks/*/comments',async r=>{
  const body=r.request().postDataJSON();calls.push(body)
  if(calls.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}})
  await r.fulfill({json:{comment:{...comment(99,body.body),clientRequestId:body.clientRequestId}}})
 })
 await mount(page);const input=page.getByLabel('Add a comment')
 await input.fill('<img src=x onerror=alert(1)>\nSecond line');await page.getByRole('button',{name:'Post comment',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('may have been saved');await expect(input).toHaveAttribute('readonly','')
 await page.getByRole('button',{name:'Retry submission',exact:true}).dblclick()
 await expect(page.getByText('Comment saved.',{exact:true})).toBeVisible();expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);expect(calls[0].clientRequestId).toMatch(/^[0-9a-f-]{36}$/)
 await expect(page.getByRole('dialog').locator('img')).toHaveCount(0);await expect(page.getByText('<img src=x onerror=alert(1)>\nSecond line',{exact:true})).toBeVisible()
 await expect(page.getByText('Registered Owner',{exact:true})).toBeVisible();await expect(page.locator('time')).toHaveAttribute('datetime','2026-10-16T00:00:00.000Z')
})
test('validation, keyboard tabs, empty historical state and narrow layout',async({page})=>{
 await page.setViewportSize({width:375,height:720});await mocks(page);await mount(page)
 await expect(page.getByRole('tab',{name:'Comments',exact:true})).toBeFocused()
 const input=page.getByLabel('Add a comment');await input.fill('x'.repeat(4001));await expect(page.getByText('Comments must be 4,000 characters or fewer.')).toBeVisible();await expect(page.getByRole('button',{name:'Post comment',exact:true})).toBeDisabled()
 await input.fill('\u{1f600}'.repeat(4000));await expect(page.getByText('0 characters remaining',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Post comment',exact:true})).toBeEnabled()
 await page.getByRole('tab',{name:'Comments',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'Activity History'})).toBeFocused()
 await expect(page.getByText('No recorded activity. Tracking may have started after this task was created.')).toBeVisible()
 expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await page.getByRole('button',{name:'Close task details'}).focus();await page.keyboard.press('Shift+Tab');await expect(page.getByRole('dialog')).toContainText('Activity History');expect(await page.evaluate(()=>document.activeElement.closest('dialog')!==null)).toBe(true)
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0)
})
for(const stream of ['comments','activity'])test(`${stream} pagination retains loaded rows through error and retry`,async({page})=>{
 await mocks(page);let fail=true;const make=stream==='comments'?comment:activity
 await page.route(`**/api/project-tasks/*/${stream}?*`,r=>{
  if(new URL(r.request().url()).searchParams.has('before')){
   if(fail){fail=false;return r.fulfill({status:503,json:{}})}
   return r.fulfill({json:feed(stream,[make(1)])})
  }
  return r.fulfill({json:feed(stream,Array.from({length:20},(_,i)=>make(30-i)),true)})
 })
 await mount(page);if(stream==='activity')await page.getByRole('tab',{name:'Activity History'}).click()
 const panel=page.getByRole('tabpanel');await expect(panel.locator('li')).toHaveCount(20)
 await page.getByRole('button',{name:stream==='comments'?'Load more comments':'Load more activity',exact:true}).click()
 await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.locator('li')).toHaveCount(20)
 await page.getByRole('button',{name:stream==='comments'?'Retry comments':'Retry activity history',exact:true}).click();await expect(panel.locator('li')).toHaveCount(21)
 if(stream==='activity'){await expect(panel.getByText('System',{exact:false}).first()).toBeVisible();await expect(panel.getByText('Status changed from To Do to Done.').first()).toBeVisible()}
})
for(const status of [401,403,404])test(`denied ${status} hides collaboration`,async({page})=>{
 await mocks(page);await page.route('**/api/project-tasks/*/comments?*',r=>r.fulfill({status,json:{}}));await mount(page)
 await expect(page.getByRole('alert')).toContainText('no longer have permission');await expect(page.getByRole('tab')).toHaveCount(0);await expect(page.getByLabel('Add a comment')).toHaveCount(0)
})
for(const change of ['task','project','account'])test(`late ${change} response cannot leak into next scope`,async({page})=>{
 await mocks(page);let release
 await page.route('**/api/project-tasks/*/comments?*',async r=>{
  if(!release){await new Promise(resolve=>{release=resolve});return r.fulfill({json:feed('comments',[comment(1,'Private previous scope')])}).catch(()=>{})}
  const nextTask=new URL(r.request().url()).pathname.split('/').at(-2);await r.fulfill({json:{...feed('comments'),taskId:nextTask}})
 })
 await mount(page);await expect.poll(()=>typeof release).toBe('function');await expect(page.getByText('Loading comments…')).toBeVisible()
 await page.evaluate(({task,change})=>window.renderDetails({task:change==='task'?{...task,id:'44444444-4444-4444-8444-444444444444'}:change==='project'?{...task,projectId:'second'}:task,...(change==='account'?{ownerId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',token:'next-token'}:{})}),{task,change})
 await expect(page.getByLabel('Add a comment')).toBeVisible();release();await expect(page.getByText('Private previous scope')).toHaveCount(0)
})
test('malformed cursor fails closed and can retry without fallback',async({page})=>{
 await mocks(page);await page.route('**/api/project-tasks/*/comments?*',r=>r.fulfill({json:{...feed('comments',[comment()],true),nextCursor:'forged'}}));await mount(page)
 await expect(page.getByRole('alert')).toContainText('Could not load comments');await expect(page.locator('li')).toHaveCount(0)
 await page.unroute('**/api/project-tasks/*/comments?*');await page.route('**/api/project-tasks/*/comments?*',r=>r.fulfill({json:feed('comments')}));await page.getByRole('button',{name:'Retry comments'}).click();await expect(page.getByText('No comments yet. Start the conversation with a note.')).toBeVisible()
})
test('Tasks and assigned/candidate sprint lists open details and restore focus',async({page})=>{
 await mocks(page)
 await page.addInitScript(({ownerId})=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{id:ownerId,email:'owner@test',role:'Developer'},token:'details-token',rememberMe:true},version:0})),{ownerId})
 await page.route('**/api/project-members/projects',r=>r.fulfill({json:{projects:[{id:'owned',name:'Owned project',ownerId,access:'owner'}]}}))
 await page.route('**/api/workspace/projects',r=>r.fulfill({json:{projects:[{id:'owned',name:'Owned project'}]}}))
 await page.route('**/api/project-tasks?*',r=>r.fulfill({json:{tasks:[task],total:1,limit:20,offset:0}}))
 await page.goto('/tasks');const opener=page.getByRole('button',{name:`View details for ${task.title}`,exact:true});await opener.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(opener).toBeFocused()
 const sprint={id:'55555555-5555-4555-8555-555555555555',projectId:'owned',name:'Release',goal:'Ship',startDate:'2026-10-15',endDate:'2026-10-16',status:'Planning',counts:{toDo:1,inProgress:0,done:0,total:1},empty:false,progress:0}
 await page.route('**/api/project-sprints**',r=>{const u=new URL(r.request().url());return r.fulfill({json:u.pathname.endsWith('/tasks')?{tasks:[{...task,sprintId:sprint.id}],total:1,limit:20,offset:0}:u.pathname.endsWith(sprint.id)?{sprint}:{sprints:[sprint],total:1,limit:20,offset:0}})})
 await page.goto('/sprints');await page.getByRole('button',{name:'Manage tasks',exact:true}).click()
 for(const label of ['Assigned sprint tasks','Project task candidates']){await page.getByRole('region',{name:label,exact:true}).getByRole('button',{name:`View details for ${task.title}`}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape')}
})


test('pending post survives close with same retry identity and cannot update another task',async({page})=>{
 await mocks(page);let release;const calls=[]
 await page.route('**/api/project-tasks/*/comments',async r=>{
  const payload=r.request().postDataJSON();calls.push(payload)
  if(calls.length===1)await new Promise(resolve=>{release=resolve})
  await r.fulfill({json:{comment:{...comment(50,payload.body),clientRequestId:payload.clientRequestId}}}).catch(()=>{})
 })
 await mount(page);await page.getByLabel('Add a comment').fill('Uncertain saved comment');await page.getByRole('button',{name:'Post comment',exact:true}).click();await expect.poll(()=>typeof release).toBe('function')
 await page.keyboard.press('Escape');await page.evaluate(task=>window.renderDetails({task:{...task,id:'44444444-4444-4444-8444-444444444444'}}),task)
 release();await expect(page.getByText('Comment saved.',{exact:true})).toHaveCount(0)
 await page.evaluate(task=>window.renderDetails({task}),task);await expect(page.getByLabel('Add a comment')).toHaveValue('Uncertain saved comment')
 await page.getByRole('button',{name:'Retry submission',exact:true}).click();await expect(page.getByText('Comment saved.',{exact:true})).toBeVisible();expect(calls[1]).toEqual(calls[0])
})
