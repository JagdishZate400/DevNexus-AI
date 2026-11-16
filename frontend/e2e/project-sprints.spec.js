import {test,expect} from '@playwright/test'
const projects=[{id:'owned',name:'DevNexus Test Project'},{id:'second',name:'Other owned project'}]
const baseSprint={id:'11111111-1111-4111-8111-111111111111',projectId:'owned',creatorId:'owner',name:'Demo preparation',goal:'Complete workflows',startDate:'2026-10-15',endDate:'2026-10-16',status:'Planning',createdAt:'2026-10-15',updatedAt:'2026-10-15'}
const baseTask={id:'22222222-2222-4222-8222-222222222222',projectId:'owned',title:'Verify exports',description:'Check saved document',priority:'Medium',status:'To Do',sprintId:null,assigneeUserId:null,assignee:null}
async function setup(page,sprints=[baseSprint],tasks=[baseTask]){
 const state={sprints:structuredClone(sprints),tasks:structuredClone(tasks),calls:[]}
 const summary=s=>{const tasks=state.tasks.filter(t=>t.sprintId===s.id),counts={toDo:tasks.filter(t=>t.status==='To Do').length,inProgress:tasks.filter(t=>t.status==='In Progress').length,done:tasks.filter(t=>t.status==='Done').length,total:tasks.length};return {...s,counts,empty:!tasks.length,progress:tasks.length?Math.round(counts.done/tasks.length*10000)/100:null}}
 await page.context().addInitScript(()=>{localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{id:'owner',email:'sprint@example.test',role:'Developer'},token:'sprint-token',rememberMe:true},version:0}));localStorage.setItem('ai-assistant-sprints',JSON.stringify({state:{sprints:[{id:'demo',name:'Private stale legacy sprint'}]},version:0}))})
 await page.context().route('**/api/**',r=>r.fulfill({json:{user:{id:'owner',email:'sprint@example.test',role:'Developer'}}}))
 await page.context().route('**/api/workspace/projects',r=>r.fulfill({json:{projects}}))
 await page.context().route('**/api/project-members/projects',r=>r.fulfill({json:{projects:projects.map(p=>({...p,ownerId:'owner',access:'owner'}))}}))
 await page.context().route('**/api/project-tasks**',r=>{const u=new URL(r.request().url());if(r.request().method()==='PATCH'){const task=state.tasks.find(t=>t.id===u.pathname.split('/').at(-1));Object.assign(task,r.request().postDataJSON());return r.fulfill({json:{task}})}const offset=Number(u.searchParams.get('offset')),tasks=state.tasks.filter(t=>t.projectId===u.searchParams.get('projectId'));return r.fulfill({json:{tasks:tasks.slice(offset,offset+20),total:tasks.length,limit:20,offset}})})
 await page.context().route('**/api/project-sprints**',r=>{
  const u=new URL(r.request().url()),parts=u.pathname.split('/').slice(3),[id,segment,taskId]=parts,method=r.request().method(),body=r.request().postDataJSON(),offset=Number(u.searchParams.get('offset') || 0)
  state.calls.push({method,path:u.pathname,body,query:u.search});expect(r.request().headers().authorization).toBe('Bearer sprint-token')
  if(!id){
   if(method==='POST'){const s={...baseSprint,...body,id:crypto.randomUUID(),status:'Planning'};state.sprints.unshift(s);return r.fulfill({status:201,json:{sprint:summary(s)}})}
   const sprints=state.sprints.filter(s=>s.projectId===u.searchParams.get('projectId'));return r.fulfill({json:{sprints:sprints.slice(offset,offset+20).map(summary),total:sprints.length,limit:20,offset}})
  }
  const s=state.sprints.find(s=>s.id===id);if(!s)return r.fulfill({status:404,json:{message:'Owned sprint not found.'}})
  if(segment==='tasks'){
   if(method==='GET'){const tasks=state.tasks.filter(t=>t.sprintId===id);return r.fulfill({json:{tasks:tasks.slice(offset,offset+20),total:tasks.length,limit:20,offset}})}
   const t=state.tasks.find(t=>t.id===taskId && t.projectId===s.projectId)
   if(!t)return r.fulfill({status:404,json:{message:'Owned task not found.'}})
   if(t.sprintId && t.sprintId!==id)return r.fulfill({status:409,json:{message:'Task belongs to another sprint. Remove its assignment first.',code:'task_already_assigned'}})
   t.sprintId=method==='DELETE'?null:id;return r.fulfill({json:{sprint:summary(s)}})
  }
  if(method==='PATCH')Object.assign(s,body)
  return r.fulfill({json:{sprint:summary(s)}})
 })
 return state
}
async function open(page){await page.goto('/sprints');await expect(page.getByRole('button',{name:'New Sprint',exact:true})).toBeEnabled()}
async function form(page,name='Release'){const d=page.getByRole('dialog');await d.getByLabel('Sprint name',{exact:true}).fill(name);await d.getByLabel('Goal',{exact:true}).fill('Ship core functionality');await d.getByLabel('Start date').fill('2026-10-15');await d.getByLabel('End date').fill('2026-10-16');return d}
async function manage(page){await page.getByRole('button',{name:'Manage tasks',exact:true}).first().click();await expect(page.getByRole('button',{name:'Assign Verify exports',exact:true})).toBeEnabled()}

test('sprints show person assignment independently of sprint placement',async({page})=>{
 const person={userId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',displayName:'Registered Person',email:'person@sprint.test'}
 const state=await setup(page,[baseSprint],[{...baseTask,assigneeUserId:person.userId,assignee:person}])
 await open(page);await manage(page)
 await expect(page.getByRole('region',{name:'Project task candidates'}).getByText(person.email,{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Assign Verify exports',exact:true}).click()
 await expect(page.getByRole('region',{name:'Assigned sprint tasks'}).getByText(person.email,{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Remove Verify exports',exact:true}).click()
 await expect(page.getByRole('region',{name:'Assigned sprint tasks'}).getByText('No tasks assigned',{exact:true})).toBeVisible()
 expect(state.tasks[0].assigneeUserId).toBe(person.userId);expect(state.tasks[0].sprintId).toBe(null)
 expect(state.calls.filter(c=>['PUT','DELETE'].includes(c.method)).every(c=>!c.body)).toBe(true)
})
test('sprints real owned project selection, create payload, no legacy fallback and refresh persistence',async({page})=>{
 const state=await setup(page,[]);await open(page);await expect(page.getByLabel('Sprints project')).toHaveValue('owned');await expect(page.getByText('Private stale legacy sprint')).toHaveCount(0)
 await page.getByRole('button',{name:'New Sprint',exact:true}).click();const d=await form(page);await d.getByRole('button',{name:'Create sprint',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Release',exact:true})).toBeVisible()
 expect(state.calls.find(c=>c.method==='POST').body).toEqual({projectId:'owned',name:'Release',goal:'Ship core functionality',startDate:'2026-10-15',endDate:'2026-10-16',status:'Planning'})
 await page.reload();await expect(page.getByRole('heading',{name:'Release',exact:true})).toBeVisible()
 await expect(page.getByText('No tasks assigned',{exact:true})).toBeVisible();await expect(page.getByRole('progressbar')).toHaveCount(0)
})
test('sprints edit name goal dates and lifecycle status using durable PATCH only',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'Edit',exact:true}).click();const d=await form(page,'Edited sprint');await d.getByLabel('Sprint status').selectOption('Active');await d.getByRole('button',{name:'Save sprint',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Edited sprint',exact:true})).toBeVisible()
 await page.getByLabel('Status for Edited sprint').selectOption('Completed');await expect(page.getByRole('status')).toContainText('Task statuses were unchanged')
 expect(state.tasks[0].status).toBe('To Do');await page.reload();await expect(page.getByLabel('Status for Edited sprint')).toHaveValue('Completed')
})
test('sprints assign remove and refresh authoritative progress after task status changes',async({page})=>{
 const state=await setup(page);await open(page);await manage(page)
 await page.getByRole('button',{name:'Assign Verify exports',exact:true}).click();const assigned=page.getByRole('region',{name:'Assigned sprint tasks'})
 await expect(assigned.getByText('Verify exports',{exact:true})).toBeVisible();expect(state.tasks[0].sprintId).toBe(baseSprint.id)
 await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow','0')
 state.tasks[0].status='Done';await page.getByRole('button',{name:'Refresh sprint details'}).click();await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow','100')
 await expect(assigned.getByText('Done',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Remove Verify exports',exact:true}).click();await expect(assigned.getByText('No tasks assigned',{exact:true})).toBeVisible();expect(state.tasks[0].sprintId).toBe(null)
 await page.reload();await expect(page.getByRole('progressbar')).toHaveCount(0)
})
test('sprints assignment conflict shows backend explanation without false success',async({page})=>{
 const state=await setup(page,[baseSprint],[{...baseTask,sprintId:'33333333-3333-4333-8333-333333333333'}]);await open(page);await manage(page);await page.getByRole('button',{name:'Assign Verify exports',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Task belongs to another sprint');expect(state.tasks[0].sprintId).toBe('33333333-3333-4333-8333-333333333333')
 await expect(page.getByRole('region',{name:'Assigned sprint tasks'}).getByText('No tasks assigned')).toBeVisible()
})
test('sprints mutation failures preserve saved status and form without fake success',async({page})=>{
 await setup(page);await open(page)
 await page.route('**/api/project-sprints**',r=>r.request().method()==='GET'?r.fallback():r.fulfill({status:503,json:{message:'Sprint storage unavailable.'}}))
 await page.getByLabel('Status for Demo preparation').selectOption('Active');await expect(page.getByRole('alert')).toContainText('Sprint storage unavailable');await expect(page.getByLabel('Status for Demo preparation')).toHaveValue('Planning')
 await page.getByRole('button',{name:'Edit',exact:true}).click();let d=await form(page,'Unsaved');await d.getByRole('button',{name:'Save sprint',exact:true}).click();await expect(d.getByRole('alert')).toContainText('Sprint storage unavailable');await d.getByRole('button',{name:'Cancel'}).click()
 await page.getByRole('button',{name:'New Sprint',exact:true}).click();d=await form(page,'Not created');await d.getByRole('button',{name:'Create sprint',exact:true}).click();await expect(d.getByRole('alert')).toContainText('Sprint storage unavailable');await expect(page.getByRole('heading',{name:'Not created',exact:true})).toHaveCount(0)
})
test('sprints project isolation and late responses discard previous project data',async({page})=>{
 await setup(page,[baseSprint,{...baseSprint,id:'other-id',projectId:'second',name:'Second sprint'}]);await open(page)
 let release;const held=new Promise(resolve=>release=resolve)
 await page.route('**/api/project-sprints?*',async r=>{if(new URL(r.request().url()).searchParams.get('projectId')==='owned')await held;await r.fallback()})
 await page.getByRole('button',{name:'Refresh sprints',exact:true}).click();await page.getByLabel('Sprints project').selectOption('second');await expect(page.getByRole('heading',{name:'Second sprint',exact:true})).toBeVisible();release()
 await expect(page.getByRole('heading',{name:'Demo preparation',exact:true})).toHaveCount(0)
})
test('sprints pagination labels counts by loaded page and task pages remain bounded',async({page})=>{
 const sprints=Array.from({length:21},(_,i)=>({...baseSprint,id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name:'Sprint '+i})),tasks=Array.from({length:21},(_,i)=>({...baseTask,id:'task-'+i,title:'Task '+i,sprintId:i<20?'10000000-0000-4000-8000-000000000001':null}))
 const state=await setup(page,sprints,tasks);await open(page);await expect(page.getByText('21 saved sprints in this project.',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Next sprints',exact:true}).click();await expect(page.getByRole('heading',{name:'Sprint 20',exact:true})).toBeVisible();await page.getByRole('button',{name:'Previous sprints',exact:true}).click();await page.getByRole('button',{name:'Manage tasks',exact:true}).first().click()
 await page.getByRole('button',{name:'Next project tasks',exact:true}).click();await expect(page.getByRole('button',{name:'Assign Task 20',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Next assigned tasks',exact:true})).toBeDisabled();state.tasks.pop();await page.getByRole('button',{name:'Refresh project tasks',exact:true}).click();await expect(page.getByRole('button',{name:'Assign Task 0',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Previous project tasks',exact:true})).toBeDisabled()
})
test('sprints load errors retry to empty project and never expose local records',async({page})=>{
 await setup(page,[]);let fail=true
 await page.route('**/api/project-sprints?*',r=>fail?r.fulfill({status:403,json:{message:'Access denied.'}}):r.fallback())
 await page.goto('/sprints');await expect(page.getByRole('alert')).toContainText('Access denied');await expect(page.getByText('Private stale legacy sprint')).toHaveCount(0);fail=false;await page.getByRole('button',{name:'Retry sprints',exact:true}).click();await expect(page.getByText('No saved sprints in this project.',{exact:false})).toBeVisible()
})
test('sprints project loading errors and no owned projects have explicit states',async({page})=>{
 await setup(page);let fail=true;await page.route('**/api/workspace/projects',r=>r.fulfill(fail?{status:401,json:{message:'Sign in required.'}}:{json:{projects:[]}}));await page.goto('/sprints');await expect(page.getByRole('alert')).toContainText('Sign in required');fail=false;await page.getByRole('button',{name:'Retry projects',exact:true}).click();await expect(page.getByText('No owned projects found.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'New Sprint',exact:true})).toHaveCount(0)
})
test('sprints invalid dates and duplicate submit prevention',async({page})=>{
 const state=await setup(page,[]);await open(page);await page.getByRole('button',{name:'New Sprint',exact:true}).click();const d=await form(page);await d.getByLabel('End date').fill('2026-10-14');await d.getByRole('button',{name:'Create sprint',exact:true}).click();await expect(d.getByRole('alert')).toContainText('End date');expect(state.calls.filter(c=>c.method==='POST')).toHaveLength(0)
 await d.getByLabel('End date').fill('2026-10-16');let release;const held=new Promise(resolve=>release=resolve)
 await page.route('**/api/project-sprints',async r=>{if(r.request().method()==='POST')await held;await r.fallback()})
 await d.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()});await expect(d.getByRole('button',{name:'Saving...'})).toBeDisabled();release();await expect(page.getByRole('heading',{name:'Release',exact:true})).toBeVisible();expect(state.calls.filter(c=>c.method==='POST')).toHaveLength(1)
})
test('sprints malformed cross-project responses fail closed and logout removes source data',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Sign out',exact:true}).first().click();await expect(page).toHaveURL(/login/);await expect(page.getByRole('heading',{name:'Demo preparation',exact:true})).toHaveCount(0)
 await page.goto('/sprints');await page.route('**/api/project-sprints?*',r=>r.fulfill({json:{sprints:[{...baseSprint,projectId:'foreign'}],total:1,limit:20,offset:0}}));await page.reload();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('heading',{name:'Demo preparation',exact:true})).toHaveCount(0)
})
test('sprints failed assignment and removal keep authoritative membership unchanged',async({page})=>{
 const state=await setup(page);await open(page);await manage(page)
 let failPut=true,failDelete=false
 await page.route('**/api/project-sprints/*/tasks/*',r=>(r.request().method()==='PUT' && failPut) || (r.request().method()==='DELETE' && failDelete)?r.fulfill({status:503,json:{message:'Assignment storage unavailable.'}}):r.fallback())
 await page.getByRole('button',{name:'Assign Verify exports',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Assignment storage unavailable');expect(state.tasks[0].sprintId).toBe(null)
 failPut=false;await page.getByRole('button',{name:'Assign Verify exports',exact:true}).click();await expect(page.getByRole('button',{name:'Remove Verify exports',exact:true})).toBeVisible()
 failDelete=true;await page.getByRole('button',{name:'Remove Verify exports',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Assignment storage unavailable');expect(state.tasks[0].sprintId).toBe(baseSprint.id);await expect(page.getByRole('button',{name:'Remove Verify exports',exact:true})).toBeVisible()
})
test('sprints task read failures and detail errors expose retry without fake empty data',async({page})=>{
 await setup(page);await open(page)
 let fail=true
 await page.route(`**/api/project-sprints/${baseSprint.id}`,r=>fail?r.fulfill({status:503,json:{message:'Cannot read sprint.'}}):r.fallback())
 await page.getByRole('button',{name:'Manage tasks',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Cannot read sprint');await expect(page.getByRole('region',{name:'Assigned sprint tasks'})).toHaveCount(0)
 fail=false;await page.getByRole('button',{name:'Retry sprint details',exact:true}).click();await expect(page.getByRole('button',{name:'Assign Verify exports',exact:true})).toBeEnabled()
 let failTasks=true
 await page.route('**/api/project-tasks?*',r=>failTasks?r.fulfill({status:403,json:{message:'Task access denied.'}}):r.fallback())
 await page.getByRole('button',{name:'Refresh project tasks',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Task access denied');await expect(page.getByRole('button',{name:'Assign Verify exports',exact:true})).toHaveCount(0)
 failTasks=false;await page.getByRole('button',{name:'Retry project tasks',exact:true}).click();await expect(page.getByRole('button',{name:'Assign Verify exports',exact:true})).toBeEnabled()
})


test('sprints refresh persisted task transitions on return from Tasks, with assignment removal and reload',async({page,context})=>{
 const state=await setup(page);await open(page);await manage(page)
 const card=page.getByRole('article',{name:`Sprint: ${baseSprint.name}`})
 await expect(card).toContainText('Assigned: 0')
 const taskTab=await context.newPage();await taskTab.goto('/tasks')
 await expect(taskTab.getByText('No sprint assigned.',{exact:false})).toBeVisible()
 await taskTab.getByLabel('Status for Verify exports').selectOption('Done')
 await expect(taskTab.getByRole('status')).toContainText('Task status saved.')
 await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect(card).toContainText('Assigned: 0')
 await page.getByRole('button',{name:'Assign Verify exports',exact:true}).click()
 await expect(card).toContainText('Done: 1 / Assigned: 1')
 for(const [status,counts] of [['To Do','To Do: 1 / In Progress: 0 / Done: 0'],['In Progress','To Do: 0 / In Progress: 1 / Done: 0'],['Done','To Do: 0 / In Progress: 0 / Done: 1']]){
  await taskTab.bringToFront();await taskTab.getByLabel('Status for Verify exports').selectOption(status)
  await expect(taskTab.getByRole('status')).toContainText('Task status saved.')
  await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect(card).toContainText(counts)
  await expect(page.getByRole('region',{name:'Assigned sprint tasks'}).getByText(status,{exact:true})).toBeVisible()
 }
 await page.reload();await expect(card).toContainText('Done: 1 / Assigned: 1')
 await page.getByRole('button',{name:'Manage tasks',exact:true}).click()
 await page.getByRole('button',{name:'Remove Verify exports',exact:true}).click()
 await expect(card).toContainText('Assigned: 0');expect(state.tasks[0].status).toBe('Done')
 await page.reload();await expect(card).toContainText('Assigned: 0')
 await taskTab.close()
})

test('sprints counts include assigned tasks beyond the first task page',async({page})=>{
 const tasks=Array.from({length:25},(_,i)=>({...baseTask,id:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title:`Task ${i}`,status:i<20?'To Do':'Done',sprintId:baseSprint.id}))
 await setup(page,[baseSprint],tasks);await open(page)
 const card=page.getByRole('article',{name:`Sprint: ${baseSprint.name}`})
 await expect(card).toContainText('To Do: 20 / In Progress: 0 / Done: 5 / Assigned: 25')
 await page.getByRole('button',{name:'Manage tasks',exact:true}).click()
 await page.getByRole('button',{name:'Next assigned tasks',exact:true}).click()
 await expect(page.getByRole('button',{name:'Remove Task 24',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Assign Task 0',exact:true})).toBeDisabled()
 await expect(card).toContainText('Assigned: 25')
})
