import {test,expect} from '@playwright/test'
const projects=[{id:'owned-p',name:'DevNexus Test Project'},{id:'other-p',name:'Other owned project'}]
const fixtureTask={id:'11111111-1111-4111-8111-111111111111',projectId:'owned-p',creatorId:'owner',title:'Verify documentation export',description:'Check saved PDF.',status:'To Do',priority:'Medium',createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',assigneeUserId:null,assignee:null,sprintId:null}
async function setup(page,initial=[fixtureTask]){
 const state={tasks:initial.map(task=>({...task})),calls:[]}
 await page.addInitScript(()=>{localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'tasks@example.test',role:'Developer'},token:'tasks-token',rememberMe:true},version:0}));localStorage.setItem('ai-assistant-tasks',JSON.stringify({state:{tasks:[{id:'demo',title:'Private stale demo task'}]},version:0}))})
 await page.route('**/api/**',r=>r.fulfill({json:{user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'tasks@example.test',role:'Developer'}}}))
 await page.route('**/api/project-members?*',r=>r.fulfill({json:{projectId:new URL(r.request().url()).searchParams.get('projectId'),owner:{userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',displayName:'Owner',email:'tasks@example.test'},members:[],total:0,limit:20,offset:0}}))
 await page.route('**/api/project-members/projects',r=>r.fulfill({json:{projects:projects.map(p=>({...p,ownerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',access:'owner'}))}}))
 await page.route('**/api/project-tasks**',r=>{
  const url=new URL(r.request().url()),method=r.request().method();state.calls.push({method,url:url.pathname,body:r.request().postDataJSON()})
  expect(r.request().headers().authorization).toBe('Bearer tasks-token')
  if(method==='GET'){
   const projectId=url.searchParams.get('projectId'),offset=Number(url.searchParams.get('offset'));expect(url.searchParams.get('limit')).toBe('20')
   const tasks=state.tasks.filter(task=>task.projectId===projectId);return r.fulfill({json:{tasks:tasks.slice(offset,offset+20),total:tasks.length,limit:20,offset}})
  }
  if(method==='POST'){const body=r.request().postDataJSON();const task={...fixtureTask,...body,id:crypto.randomUUID()};state.tasks.unshift(task);return r.fulfill({status:201,json:{task}})}
  const id=url.pathname.split('/').at(-1),task=state.tasks.find(task=>task.id===id)
  if(!task)return r.fulfill({status:404,json:{message:'Owned task not found.'}})
  if(method==='PATCH'){Object.assign(task,r.request().postDataJSON());return r.fulfill({json:{task}})}
  if(method==='DELETE'){state.tasks=state.tasks.filter(task=>task.id!==id);return r.fulfill({status:204})}
 })
 return state
}
async function open(page){await page.goto('/tasks');await expect(page.getByLabel('Tasks project')).toHaveValue('owned-p');await expect(page.getByRole('button',{name:'New Task',exact:true})).toBeEnabled()}
test('tasks real projects, durable create payload, optional description and refresh persistence',async({page})=>{
 const state=await setup(page,[]);await open(page)
 await expect(page.getByRole('heading',{name:'No tasks in this project'})).toBeVisible()
 await page.getByRole('button',{name:'New Task',exact:true}).click();const dialog=page.getByRole('dialog')
 await expect(dialog.getByLabel('Project',{exact:true})).toHaveValue('owned-p');await expect(dialog.getByLabel('Assignee',{exact:true})).toBeVisible()
 await dialog.getByLabel('Title',{exact:true}).fill('Real saved task');await dialog.getByLabel('Priority',{exact:true}).selectOption('High')
 await dialog.getByRole('button',{name:'Create task',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Real saved task',exact:true})).toBeVisible()
 expect(state.calls.find(call=>call.method==='POST').body).toEqual({projectId:'owned-p',title:'Real saved task',description:'',priority:'High',assigneeUserId:null})
 await page.reload();await expect(page.getByRole('heading',{name:'Real saved task',exact:true})).toBeVisible()
 await expect(page.getByText('Private stale demo task')).toHaveCount(0)
})
test('tasks edit saved fields and status without changing project identity',async({page})=>{
 const state=await setup(page);await open(page)
 await page.getByRole('article',{name:`Task: ${fixtureTask.title}`}).getByRole('button',{name:'Edit',exact:true}).click()
 const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('Project',{exact:true})).toBeDisabled()
 await dialog.getByLabel('Title',{exact:true}).fill('Edited task');await dialog.getByLabel('Description',{exact:true}).fill('Saved edited description');await dialog.getByRole('button',{name:'Save changes',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Edited task',exact:true})).toBeVisible()
 await page.getByLabel('Status for Edited task').selectOption('Done');await expect(page.getByText('Task status saved.',{exact:true})).toBeVisible()
 expect(state.tasks[0].status).toBe('Done');expect(state.calls.find(call=>call.method==='PATCH').body).toEqual({title:'Edited task',description:'Saved edited description',priority:'Medium'})
 await page.reload();await expect(page.getByLabel('Status for Edited task')).toHaveValue('Done')
})
test('tasks deletion requires explicit confirmation and cancellation changes nothing',async({page})=>{
 const state=await setup(page);await open(page)
 await page.getByRole('article',{name:`Task: ${fixtureTask.title}`}).getByRole('button',{name:'Delete',exact:true}).click()
 await page.getByRole('alertdialog').getByRole('button',{name:'Cancel',exact:true}).click();expect(state.calls.some(call=>call.method==='DELETE')).toBe(false)
 await page.getByRole('article',{name:`Task: ${fixtureTask.title}`}).getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Delete task',exact:true}).click()
 await expect(page.getByRole('heading',{name:'No tasks in this project'})).toBeVisible();expect(state.tasks).toHaveLength(0)
})
test('tasks failed create/edit/status/delete never become local success',async({page})=>{
 await setup(page);await open(page)
 await page.route('**/api/project-tasks**',r=>r.request().method()==='GET' ? r.fallback() : r.fulfill({status:503,json:{message:'Task storage unavailable.'}}))
 await page.getByLabel(`Status for ${fixtureTask.title}`).selectOption('Done');await expect(page.getByRole('alert')).toHaveText('Task storage unavailable.');await expect(page.getByLabel(`Status for ${fixtureTask.title}`)).toHaveValue('To Do')
 await page.getByRole('article',{name:`Task: ${fixtureTask.title}`}).getByRole('button',{name:'Edit',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel('Title',{exact:true}).fill('Unsaved edit');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveText('Task storage unavailable.');await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Unsaved edit',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'New Task',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('Title',{exact:true}).fill('Unsaved create');await dialog.getByRole('button',{name:'Create task',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveText('Task storage unavailable.');await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 await page.getByRole('article',{name:`Task: ${fixtureTask.title}`}).getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Delete task',exact:true}).click();await expect(page.getByRole('alertdialog').getByRole('alert')).toHaveText('Task storage unavailable.')
 await page.getByRole('alertdialog').getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('heading',{name:fixtureTask.title,exact:true})).toBeVisible()
})
test('tasks project isolation and late responses never display the previous project tasks',async({page})=>{
 await setup(page,[fixtureTask,{...fixtureTask,id:'22222222-2222-4222-8222-222222222222',projectId:'other-p',title:'Other project task'}]);await open(page)
 let release
 await page.route('**/api/project-tasks?*',async r=>{if(new URL(r.request().url()).searchParams.get('projectId')==='owned-p'){await new Promise(resolve=>{release=resolve});await r.fulfill({json:{tasks:[fixtureTask],total:1,limit:20,offset:0}}).catch(()=>{})}else await r.fallback()})
 await page.getByRole('button',{name:'Refresh tasks',exact:true}).click();await expect.poll(()=>typeof release).toBe('function')
 await page.getByLabel('Tasks project').selectOption('other-p');release()
 await expect(page.getByRole('heading',{name:'Other project task',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:fixtureTask.title,exact:true})).toHaveCount(0)
})
test('tasks malformed/cross-project API records fail closed without seeded fallback',async({page})=>{
 await setup(page);await page.route('**/api/project-tasks?*',r=>r.fulfill({json:{tasks:[{...fixtureTask,projectId:'foreign'}],total:1,limit:20,offset:0}}))
 await page.goto('/tasks');await expect(page.getByRole('alert')).toContainText('Could not load project tasks');await expect(page.getByRole('heading',{name:fixtureTask.title,exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'New Task',exact:true})).toBeDisabled()
})
test('tasks pagination, page counts and filters stay accurate for 21 records',async({page})=>{
 await setup(page,Array.from({length:21},(_,index)=>({...fixtureTask,id:`task-${index}`,title:`Task ${index}`,status:index===20?'Done':'To Do'})));await open(page)
 await expect(page.getByText(/21 saved tasks in this project/)).toBeVisible();await expect(page.getByText('Loaded (this page)',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Next tasks',exact:true}).click();await expect(page.getByRole('heading',{name:'Task 20',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Task 0',exact:true})).toHaveCount(0)
 await page.getByLabel('Filter by status').selectOption('To Do');await expect(page.getByRole('heading',{name:/No tasks match/})).toBeVisible();await page.getByRole('button',{name:'Clear filters',exact:true}).click()
 await page.getByLabel('Search project tasks').fill('not found');await expect(page.getByRole('heading',{name:/No tasks match/})).toBeVisible();await page.getByRole('button',{name:'Clear filters',exact:true}).click()
 await expect(page.getByRole('button',{name:'Next tasks',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Previous tasks',exact:true}).click();await expect(page.getByRole('heading',{name:'Task 0',exact:true})).toBeVisible()
})
test('tasks deleting the only last-page record returns to a valid previous page',async({page})=>{
 await setup(page,Array.from({length:21},(_,index)=>({...fixtureTask,id:`task-${index}`,title:`Task ${index}`})));await open(page);await page.getByRole('button',{name:'Next tasks',exact:true}).click()
 await page.getByRole('article',{name:'Task: Task 20'}).getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Delete task',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Task 0',exact:true})).toBeVisible();await expect(page.getByText(/20 saved tasks in this project/)).toBeVisible()
})
test('tasks loading/error/retry states and empty owned project listing are explicit',async({page})=>{
 await setup(page,[]);let release,fail=true
 await page.route('**/api/project-tasks?*',async r=>{if(fail){await new Promise(resolve=>{release=resolve});await r.fulfill({status:403,json:{message:'Task access denied.'}})}else await r.fallback()})
 await page.goto('/tasks');await expect(page.getByText('Loading project tasks...',{exact:true})).toBeVisible();await expect.poll(()=>typeof release).toBe('function');release()
 await expect(page.getByRole('alert')).toHaveText('Task access denied.');fail=false;await page.getByRole('button',{name:'Retry task loading',exact:true}).click();await expect(page.getByRole('heading',{name:'No tasks in this project'})).toBeVisible()
})
test('tasks owned-project errors and empty listing cannot expose demo projects',async({page})=>{
 await setup(page,[]);let fail=true
 await page.route('**/api/project-members?*',r=>r.fulfill({json:{projectId:new URL(r.request().url()).searchParams.get('projectId'),owner:{userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',displayName:'Owner',email:'tasks@example.test'},members:[],total:0,limit:20,offset:0}}))
 await page.route('**/api/project-members/projects',r=>r.fulfill(fail ? {status:503,json:{message:'Projects unavailable.'}} : {json:{projects:[]}}))
 await page.goto('/tasks');await expect(page.getByRole('alert')).toHaveText('Projects unavailable.');fail=false;await page.getByRole('button',{name:'Retry project loading',exact:true}).click();await expect(page.getByText(/No Team projects found/)).toBeVisible();await expect(page.getByRole('button',{name:'New Task',exact:true})).toHaveCount(0)
})
test('tasks modal blocks duplicate create requests and can create in another owned project',async({page})=>{
 const state=await setup(page,[]);await open(page);let release,posts=0
 await page.route('**/api/project-tasks',async r=>{if(r.request().method()!=='POST')return r.fallback();posts++;await new Promise(resolve=>{release=resolve});return r.fallback()})
 await page.getByRole('button',{name:'New Task',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Title',{exact:true}).fill('Task in other project');await dialog.getByLabel('Project',{exact:true}).selectOption('other-p');await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
 try{await expect(dialog.getByRole('button',{name:'Saving...',exact:true})).toBeDisabled();await expect.poll(()=>posts).toBe(1)}finally{release()}
 await expect(page.getByLabel('Tasks project')).toHaveValue('other-p');await expect(page.getByRole('heading',{name:'Task in other project',exact:true})).toBeVisible();expect(state.calls.filter(call=>call.method==='POST')).toHaveLength(1)
})
test('tasks logout removes durable tasks and does not persist them in legacy cache',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Sign out',exact:true}).first().click();await expect(page).toHaveURL(/login/)
 await expect(page.getByRole('heading',{name:fixtureTask.title,exact:true})).toHaveCount(0)
 const cached=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-assistant-tasks')))
 expect(JSON.stringify(cached)).not.toContain(fixtureTask.title)
})
