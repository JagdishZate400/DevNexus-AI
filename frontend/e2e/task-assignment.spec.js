import {test,expect} from '@playwright/test'
const ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const owner={userId:ownerId,displayName:'Project owner',email:'owner@assignment.test'}
const member=(i,projectId='owned')=>({id:`membership-${i}`,projectId,userId:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,displayName:'Registered Person',email:`person${i}@assignment.test`,displayRole:['Developer','Tester','Viewer'][i%3]})
const baseTask={id:'11111111-1111-4111-8111-111111111111',projectId:'owned',creatorId:ownerId,title:'Assignment work',description:'Keep this content',status:'To Do',priority:'High',assigneeUserId:null,assignee:null,sprintId:'22222222-2222-4222-8222-222222222222'}
const projects=[{id:'owned',name:'Owned project'},{id:'other',name:'Other project'}]
async function setup(page,{tasks=[baseTask],count=25}={}){
 const state={tasks:structuredClone(tasks),members:Array.from({length:count},(_,i)=>member(i)),calls:[],directoryCalls:[]}
 await page.addInitScript(ownerId=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{id:ownerId,email:'owner@assignment.test',role:'Developer'},token:'assignment-token',rememberMe:true},version:0})),ownerId)
 await page.route('**/api/**',r=>r.fulfill({json:{user:{id:ownerId,email:'owner@assignment.test',role:'Developer'}}}))
 await page.route('**/api/project-members/projects',r=>r.fulfill({json:{projects:projects.map(p=>({...p,ownerId:ownerId,access:'owner'}))}}))
 await page.route('**/api/project-members?*',r=>{
  const url=new URL(r.request().url()),projectId=url.searchParams.get('projectId'),offset=Number(url.searchParams.get('offset'))
  state.directoryCalls.push({projectId,offset,token:r.request().headers().authorization})
  const members=projectId==='owned'?state.members:[{...member(99,'other'),displayName:'Other project member'}]
  return r.fulfill({json:{projectId,owner,members:members.slice(offset,offset+20),total:members.length,limit:20,offset}})
 })
 await page.route('**/api/project-tasks**',r=>{
  const url=new URL(r.request().url()),method=r.request().method(),body=r.request().postDataJSON()
  state.calls.push({method,path:url.pathname,body})
  if(method==='GET'){const tasks=state.tasks.filter(t=>t.projectId===url.searchParams.get('projectId'));return r.fulfill({json:{tasks,total:tasks.length,limit:20,offset:0}})}
  const task=method==='POST'?{...baseTask,...body,id:crypto.randomUUID(),sprintId:null}:state.tasks.find(t=>t.id===url.pathname.split('/').at(-1))
  if(!task)return r.fulfill({status:404,json:{message:'Owned task not found.'}})
  Object.assign(task,body)
  if(Object.hasOwn(body,'assigneeUserId')){
   const person=body.assigneeUserId===ownerId?owner:state.members.find(m=>m.userId===body.assigneeUserId)
   if(body.assigneeUserId && !person)return r.fulfill({status:400,json:{code:'assignee_not_eligible',message:'Selected assignee is unavailable for this project.'}})
   task.assignee=person?{userId:person.userId,displayName:person.displayName,email:person.email}:null
  }
  if(method==='POST')state.tasks.push(task)
  return r.fulfill({status:method==='POST'?201:200,json:{task}})
 })
 return state
}
async function open(page){await page.goto('/tasks');await expect(page.getByRole('button',{name:'New Task',exact:true})).toBeEnabled()}
async function create(page,title='Assigned task'){
 await page.getByRole('button',{name:'New Task',exact:true}).click()
 await page.getByRole('dialog').getByLabel('Title',{exact:true}).fill(title)
 return page.getByRole('dialog')
}
test('assignment create with owner, paginated reassignment, clear and status/sprint preservation',async({page})=>{
 const state=await setup(page);await open(page);let dialog=await create(page)
 await expect(dialog.getByLabel('Assignee',{exact:true})).toBeEnabled()
 await dialog.getByLabel('Assignee',{exact:true}).selectOption(ownerId)
 await dialog.getByRole('button',{name:'Create task',exact:true}).click()
 let card=page.getByRole('article',{name:'Task: Assigned task'})
 await expect(card.getByText('owner@assignment.test',{exact:true})).toBeVisible()
 expect(state.calls.find(c=>c.method==='POST').body.assigneeUserId).toBe(ownerId)
 await card.getByRole('button',{name:'Edit',exact:true}).click();dialog=page.getByRole('dialog')
 await expect(dialog.getByText('20 of 25 registered members loaded.')).toBeVisible()
 await dialog.getByRole('button',{name:'Load more assignees'}).click()
 await expect(dialog.getByText('25 of 25 registered members loaded.')).toBeVisible()
 await expect(dialog.getByLabel('Assignee').locator('option').filter({hasText:'Registered Person'})).toHaveCount(25)
 await dialog.getByLabel('Assignee').selectOption(member(24).userId)
 await dialog.getByRole('button',{name:'Save changes'}).click()
 await expect(card.getByText('person24@assignment.test',{exact:true})).toBeVisible()
 expect(state.directoryCalls.some(c=>c.offset===20)).toBe(true)
 expect(state.directoryCalls.every(c=>c.token==='Bearer assignment-token')).toBe(true)
 await page.reload();card=page.getByRole('article',{name:'Task: Assigned task'})
 await expect(card.getByText('person24@assignment.test',{exact:true})).toBeVisible()
 await card.getByRole('button',{name:'Edit',exact:true}).click();dialog=page.getByRole('dialog')
 await expect(dialog.getByLabel('Assignee')).toBeEnabled();await dialog.getByLabel('Assignee').selectOption('')
 await dialog.getByRole('button',{name:'Save changes'}).click();await expect(card.getByText('Assignee: Unassigned')).toBeVisible()
 expect(state.calls.filter(c=>c.method==='PATCH').at(-1).body.assigneeUserId).toBe(null)
 const original=page.getByRole('article',{name:'Task: Assignment work'})
 await original.getByLabel('Status for Assignment work').selectOption('Done')
 expect(state.calls.filter(c=>c.method==='PATCH').at(-1).body).toEqual({status:'Done'})
 expect(state.tasks.find(t=>t.id===baseTask.id).sprintId).toBe(baseTask.sprintId)
})
test('assignment project change resets selected UUID and ignores late previous directory',async({page})=>{
 await setup(page);await open(page);let release,held=false
 await page.route('**/api/project-members?*',async r=>{
  if(new URL(r.request().url()).searchParams.get('projectId')==='owned' && !held){
   held=true;await new Promise(resolve=>{release=resolve});await r.fulfill({json:{projectId:'owned',owner,members:[member(0)],total:1,limit:20,offset:0}}).catch(()=>{})
  }else await r.fallback()
 })
 const dialog=await create(page);await expect.poll(()=>typeof release).toBe('function')
 await dialog.getByLabel('Project',{exact:true}).selectOption('other')
 await expect(dialog.getByLabel('Assignee')).toBeEnabled();release()
 await expect(dialog.getByLabel('Assignee')).toHaveValue('')
 await expect(dialog.getByLabel('Assignee').locator('option')).toContainText(['Unassigned',/Project owner/,/Other project member/])
 await expect(dialog.getByLabel('Assignee').locator('option[value="'+member(0).userId+'"]')).toHaveCount(0)
 await dialog.getByLabel('Assignee').selectOption(member(99).userId)
 await dialog.getByLabel('Project',{exact:true}).selectOption('owned');await expect(dialog.getByLabel('Assignee')).toHaveValue('')
 await expect(dialog.getByLabel('Assignee')).toBeEnabled()
})
for(const failure of [401,403,404,503,'network'])test(`assignment directory ${failure} has explicit retry without a local fallback`,async({page})=>{
 await setup(page,{count:0});let fail=true
 await page.route('**/api/project-members?*',r=>fail?(failure==='network'?r.abort():r.fulfill({status:failure,json:{message:'Directory unavailable.'}})):r.fallback())
 await open(page);const dialog=await create(page)
 await expect(dialog.getByRole('alert')).toContainText(failure==='network'?'Could not load assignees':'Directory unavailable')
 await expect(dialog.getByLabel('Assignee')).toBeDisabled()
 fail=false;await dialog.getByRole('button',{name:'Retry assignees'}).click()
 await expect(dialog.getByText('No registered members yet. The project owner is available.')).toBeVisible()
 await expect(dialog.getByLabel('Assignee')).toBeEnabled()
})
test('assignment second-page failure can refresh a changed directory safely',async({page})=>{
 const state=await setup(page);let fail=true
 await page.route('**/api/project-members?*',r=>Number(new URL(r.request().url()).searchParams.get('offset'))===20 && fail?r.fulfill({status:503,json:{message:'Next page unavailable.'}}):r.fallback())
 await open(page);const dialog=await create(page);await expect(dialog.getByLabel('Assignee')).toBeEnabled()
 await dialog.getByRole('button',{name:'Load more assignees'}).click();await expect(dialog.getByRole('alert')).toHaveText('Next page unavailable.')
 state.members=state.members.slice(0,2);fail=false
 await dialog.getByRole('button',{name:'Retry assignees'}).click();await expect(dialog.getByText('2 of 2 registered members loaded.')).toBeVisible()
 await expect(dialog.getByRole('button',{name:'Load more assignees'})).toHaveCount(0)
})
test('assignment rejected by backend stays in dialog and can refresh then clear',async({page})=>{
 const state=await setup(page);await open(page);const dialog=await create(page,'Rejected assignment')
 await expect(dialog.getByLabel('Assignee')).toBeEnabled();await dialog.getByLabel('Assignee').selectOption(member(0).userId)
 state.members=[]
 await dialog.getByRole('button',{name:'Create task',exact:true}).click()
 await expect(dialog.getByRole('alert')).toHaveText('Selected assignee is unavailable for this project.')
 await expect(page.getByRole('heading',{name:'Rejected assignment',exact:true})).toHaveCount(0)
 await dialog.getByRole('button',{name:'Refresh assignees'}).click();await expect(dialog.getByLabel('Assignee')).toBeEnabled()
 await dialog.getByLabel('Assignee').selectOption('');await dialog.getByRole('button',{name:'Create task',exact:true}).click()
 await expect(page.getByRole('article',{name:'Task: Rejected assignment'}).getByText('Assignee: Unassigned')).toBeVisible()
})
test('assignment malformed canonical identity fails closed',async({page})=>{
 await setup(page,{tasks:[{...baseTask,assigneeUserId:member(0).userId,assignee:{...member(1)}}]})
 await page.goto('/tasks');await expect(page.getByRole('alert')).toContainText('Could not load project tasks')
 await expect(page.getByRole('heading',{name:'Assignment work',exact:true})).toHaveCount(0)
})
test('assignment does not claim success when a valid response ignores selected UUID',async({page})=>{
 await setup(page);await open(page);const dialog=await create(page,'Not confirmed')
 await expect(dialog.getByLabel('Assignee')).toBeEnabled();await dialog.getByLabel('Assignee').selectOption(ownerId)
 await page.route('**/api/project-tasks',r=>r.fulfill({status:201,json:{task:{...baseTask,title:'Not confirmed',sprintId:null}}}))
 await dialog.getByRole('button',{name:'Create task',exact:true}).click()
 await expect(dialog.getByRole('alert')).toContainText('outcome is uncertain')
 await expect(dialog).toBeVisible()
 await expect(page.getByText('Task saved.',{exact:true})).toHaveCount(0)
})
