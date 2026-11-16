import {test,expect} from '@playwright/test'
const owner={userId:'owner',displayName:'Project Owner',email:'owner@example.test'}
const member={id:'membership-1',projectId:'owned',userId:'registered-1',displayName:'Registered Teammate',email:'member@example.test',displayRole:'Tester',createdAt:'2026-10-15',updatedAt:'2026-10-15'}
const projects=[{id:'owned',name:'DevNexus Test Project'},{id:'second',name:'Second owned project'}]
async function setup(page,members=[member]){
 const state={members:structuredClone(members),calls:[]}
 await page.addInitScript(()=>{localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{id:'owner',email:'owner@example.test',role:'Developer'},token:'directory-token',rememberMe:true},version:0}));localStorage.setItem('ai-assistant-team',JSON.stringify({state:{members:[{id:'demo',name:'Cached demo member'}]},version:0}))})
 await page.route('**/api/**',r=>r.fulfill({json:{user:{id:'owner',email:'owner@example.test',role:'Developer'}}}))
 await page.route('**/api/team**',r=>{state.calls.push({legacy:true,method:r.request().method()});return r.fulfill({status:500,json:{message:'Legacy directory must not be used.'}})})
 await page.route('**/api/project-members/projects',r=>r.fulfill({json:{projects:projects.map(p=>({...p,ownerId:'owner',access:'owner'}))}}))
 await page.route( /\/api\/project-members(?:\?|$)/,r=>{
  const req=r.request(),url=new URL(req.url()),projectId=url.searchParams.get('projectId'),offset=Number(url.searchParams.get('offset'))
  expect(req.method()).toBe('GET');expect(req.headers().authorization).toBe('Bearer directory-token');expect(url.searchParams.get('limit')).toBe('20')
  state.calls.push({method:req.method(),projectId,offset})
  const rows=state.members.filter(m=>m.projectId===projectId)
  return r.fulfill({json:{projectId,owner,members:rows.slice(offset,offset+20),total:rows.length,limit:20,offset}})
 })
 return state
}
async function open(page){await page.goto('/team');await expect(page.getByRole('region',{name:'Project owner'})).toBeVisible()}
test('directory uses real owned projects and saved members, separate owner and owner management controls',async({page})=>{
 const state=await setup(page);await open(page)
 await expect(page.getByLabel('Team project')).toHaveValue('owned')
 await expect(page.getByRole('region',{name:'Project owner'}).getByRole('heading',{name:'Project Owner',exact:true})).toBeVisible()
 await expect(page.getByRole('region',{name:'Project members'}).getByRole('heading',{name:member.displayName,exact:true})).toBeVisible()
 await expect(page.getByText('Members can view their project team and task list. Source, AI, documents, sprints, comments and activity remain owner-only.')).toBeVisible()
 await expect(page.getByRole('button',{name:'Add member',exact:true})).toBeVisible()
 expect(state.calls.every(c=>!c.legacy && c.method==='GET')).toBe(true)
 for(const text of ['Cached demo member','Sai Patel','Projects covered','Away'])await expect(page.getByText(text,{exact:true})).toHaveCount(0)
 await page.reload();await expect(page.getByRole('heading',{name:member.displayName,exact:true})).toBeVisible()
})
test('directory empty members retains owner without fabricated presence or counts',async({page})=>{
 await setup(page,[]);await open(page)
 await expect(page.getByRole('heading',{name:'No saved members in this project'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Project Owner',exact:true})).toBeVisible()
 await expect(page.getByText('Showing 0-0 of 0 saved members;', {exact:false})).toBeVisible()
})
test('directory pagination and page filters do not misrepresent project-wide role totals',async({page})=>{
 const state=await setup(page,Array.from({length:21},(_,i)=>({...member,id:'membership-'+i,userId:'registered-'+i,displayName:'Teammate '+i,displayRole:i===20?'Developer':'Tester'})));await open(page)
 await expect(page.getByText('Showing 1-20 of 21 saved members;', {exact:false})).toBeVisible()
 await page.getByLabel('Search members on this page').fill('Teammate 20');await expect(page.getByRole('heading',{name:'No members match the current page filters'})).toBeVisible()
 await page.getByRole('button',{name:'Next members',exact:true}).click();await expect(page.getByRole('heading',{name:'Teammate 20',exact:true})).toBeVisible()
 await page.getByLabel('Filter by directory role').selectOption('Tester');await expect(page.getByRole('heading',{name:'No members match the current page filters'})).toBeVisible()
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page.getByRole('heading',{name:'Teammate 20',exact:true})).toBeVisible()
 state.members.pop();await page.getByRole('button',{name:'Refresh directory',exact:true}).click();await expect(page.getByText('Showing 1-20 of 20 saved members;', {exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Previous members',exact:true})).toBeDisabled()
})
test('directory loading, server failure and retry never show cached members',async({page})=>{
 await setup(page);let release;const held=new Promise(resolve=>release=resolve);let fail=true
 await page.route('**/api/project-members?*',async r=>{if(fail){await held;return r.fulfill({status:503,json:{message:'Project membership storage is unavailable.'}})}return r.fallback()})
 await page.goto('/team');await expect(page.getByRole('status')).toContainText('Loading project directory');release()
 await expect(page.getByRole('alert')).toContainText('Project membership storage is unavailable');await expect(page.getByRole('region',{name:'Project owner'})).toHaveCount(0);await expect(page.getByText('Cached demo member')).toHaveCount(0)
 fail=false;await page.getByRole('button',{name:'Retry directory',exact:true}).click();await expect(page.getByRole('heading',{name:member.displayName,exact:true})).toBeVisible()
})
for(const status of [401,404])test(`directory rejects unauthorized or unowned project response ${status}`,async({page})=>{
 await setup(page);await page.route('**/api/project-members?*',r=>r.fulfill({status,json:{message:status===401?'Sign in required.':'Owned project not found.'}}));await page.goto('/team');await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('region',{name:'Project members'})).toHaveCount(0)
})
test('directory projects have explicit loading, error retry and empty states',async({page})=>{
 await setup(page);let release;const held=new Promise(resolve=>release=resolve);let fail=true
 await page.route('**/api/project-members/projects',async r=>{if(fail){await held;return r.fulfill({status:503,json:{message:'Project storage unavailable.'}})}return r.fulfill({json:{projects:[]}})})
 await page.goto('/team');await expect(page.getByRole('status')).toContainText('Loading Team projects');release();await expect(page.getByRole('alert')).toContainText('Project storage unavailable')
 fail=false;await page.getByRole('button',{name:'Retry projects',exact:true}).click();await expect(page.getByText('No Team projects found.',{exact:false})).toBeVisible();await expect(page.getByRole('region',{name:'Project members'})).toHaveCount(0)
})
test('directory project switch discards late responses and account logout clears visible records',async({page})=>{
 await setup(page,[member,{...member,id:'second-m',projectId:'second',userId:'second-user',displayName:'Second project teammate'}]);await open(page)
 let release;const held=new Promise(resolve=>release=resolve)
 await page.route('**/api/project-members?*',async r=>{if(new URL(r.request().url()).searchParams.get('projectId')==='owned')await held;await r.fallback()})
 await page.getByRole('button',{name:'Refresh directory',exact:true}).click();await page.getByLabel('Team project').selectOption('second');await expect(page.getByRole('heading',{name:'Second project teammate',exact:true})).toBeVisible();release();await expect(page.getByRole('heading',{name:member.displayName,exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Sign out',exact:true}).first().click();await expect(page).toHaveURL(/login/);await expect(page.getByRole('heading',{name:'Second project teammate',exact:true})).toHaveCount(0)
 const cache=await page.evaluate(()=>localStorage.getItem('ai-assistant-team'));expect(cache).not.toContain('Second project teammate')
})
test('directory malformed or cross-project rows fail closed instead of rendering source data',async({page})=>{
 await setup(page);await page.route('**/api/project-members?*',r=>r.fulfill({json:{projectId:'owned',owner,members:[{...member,projectId:'foreign'}],total:1,limit:20,offset:0}}));await page.goto('/team');await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('heading',{name:member.displayName,exact:true})).toHaveCount(0)
})
test('directory network failure offers retry and never uses seeded data',async({page})=>{
 await setup(page);await page.route('**/api/project-members?*',r=>r.abort('failed'));await page.goto('/team');await expect(page.getByRole('alert')).toContainText('Check your connection and retry');await expect(page.getByText('Cached demo member')).toHaveCount(0)
})

async function mutations(page,state){
 await page.route('**/api/project-members**',async r=>{
  const req=r.request(),method=req.method();if(method==='GET')return r.fallback()
  expect(req.headers().authorization).toBe('Bearer directory-token')
  const body=method==='DELETE'?null:req.postDataJSON(),id=new URL(req.url()).pathname.split('/').pop()
  state.calls.push({method,body,id})
  if(state.fail){await state.hold;return r.fulfill({status:state.fail,json:{message:state.fail===409?'Member could not be added.':'Membership storage unavailable.'}})}
  if(method==='POST'){
   expect(Object.keys(body).sort()).toEqual(['displayRole','email','projectId'])
   if(body.email!=='member@example.test' || state.members.some(m=>m.projectId===body.projectId && m.email===body.email))return r.fulfill({status:409,json:{message:'Member could not be added.'}})
   const added={...member,projectId:body.projectId,displayRole:body.displayRole};state.members.push(added);return r.fulfill({status:201,json:{member:added}})
  }
  const row=state.members.find(m=>m.id===id)
  if(method==='PATCH'){expect(Object.keys(body)).toEqual(['displayRole']);row.displayRole=body.displayRole;return r.fulfill({json:{member:row}})}
  expect(method).toBe('DELETE');state.members=state.members.filter(m=>m.id!==id);return r.fulfill({status:204})
 })
}
test('directory management adds registered email, updates all display roles, refreshes and confirms removal',async({page})=>{
 const state=await setup(page,[]);await mutations(page,state);await open(page)
 await page.getByLabel('Registered member email').fill('member@example.test');await page.getByRole('button',{name:'Add member',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Member added.'})).toBeVisible()
 for(const role of ['Tester','Viewer','Developer']){
  await page.getByLabel('Role for member@example.test').selectOption(role);await page.getByRole('button',{name:'Save role',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Member role updated.'})).toBeVisible();await expect(page.getByLabel('Role for member@example.test')).toHaveValue(role)
 }
 await page.reload();await expect(page.getByLabel('Role for member@example.test')).toHaveValue('Developer')
 await page.getByRole('button',{name:'Sign out',exact:true}).first().click();await expect(page).toHaveURL(/login/)
 await page.route('**/api/auth/login',r=>r.fulfill({json:{token:'directory-token',user:{id:'owner',email:'owner@example.test',role:'Developer'}}}))
 await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Password',{exact:true}).fill('Password123!');await page.getByRole('button',{name:/sign in/i}).click();await expect(page).toHaveURL(/team/)
 await page.goto('/team');await expect(page.getByLabel('Role for member@example.test')).toHaveValue('Developer')
 await page.getByLabel('Team project').selectOption('second');await expect(page.getByRole('heading',{name:'No saved members in this project'})).toBeVisible()
 await page.getByLabel('Team project').selectOption('owned');await expect(page.getByLabel('Role for member@example.test')).toBeVisible()
 await page.getByRole('button',{name:'Remove member',exact:true}).click();await page.getByRole('button',{name:'Cancel removal'}).click();expect(state.calls.filter(c=>c.method==='DELETE')).toHaveLength(0)
 await page.getByRole('button',{name:'Remove member',exact:true}).click();await page.getByRole('button',{name:'Confirm removal'}).click()
 await expect(page.getByRole('status').filter({hasText:'Member removed.'})).toBeVisible();await expect(page.getByRole('heading',{name:'No saved members in this project'})).toBeVisible()
})
test('directory mutations validate email, show conflicts and loading, and allow explicit retry after failure',async({page})=>{
 const state=await setup(page);await mutations(page,state);await open(page)
 await page.getByLabel('Registered member email').fill('invalid');await page.getByRole('button',{name:'Add member',exact:true}).click();expect(state.calls.filter(c=>c.method==='POST')).toHaveLength(0)
 for(const email of ['member@example.test','unknown@example.test']){await page.getByLabel('Registered member email').fill(email);await page.getByRole('button',{name:'Add member',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Member could not be added.')}
 let release;state.hold=new Promise(resolve=>release=resolve);state.fail=503
 await page.getByLabel('Role for member@example.test').selectOption('Viewer');await page.getByRole('button',{name:'Save role',exact:true}).click();await expect(page.getByRole('status')).toContainText('Saving membership');await expect(page.getByRole('button',{name:'Add member',exact:true})).toBeDisabled();release()
 await expect(page.getByRole('alert')).toContainText('Membership storage unavailable');state.fail=0
 await page.getByRole('button',{name:'Refresh directory'}).click();await expect(page.getByLabel('Role for member@example.test')).toHaveValue('Tester')
 await page.getByLabel('Role for member@example.test').selectOption('Viewer');await page.getByRole('button',{name:'Save role',exact:true}).click();await expect(page.getByLabel('Role for member@example.test')).toHaveValue('Viewer')
})
