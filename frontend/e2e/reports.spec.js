import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
const ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const projects=[{id:'alpha',name:'Alpha project'},{id:'beta',name:'Beta project'}]
const severities=['Critical','High','Medium','Low','Info']
function record(id='alpha'){
 return {project:{id,name:id==='alpha'?'Alpha project':'Beta project'},asOf:'2026-10-26T10:00:00.000Z',tasks:{total:150,toDo:50,inProgress:30,done:70,completionPercent:46.67},sprints:[{id:'one',name:'Delivery',status:'Active',total:90,done:70,completionPercent:77.78},{id:'two',name:'Empty sprint',status:'Planning',total:0,done:0,completionPercent:null}],reviews:{fileReviews:{total:5,byStatus:[{status:'Completed',count:3},{status:'Failed',count:1},{status:'In Progress',count:1}]},batches:{total:2,byStatus:[{status:'Completed',count:1},{status:'Partial',count:1}]},findings:{total:4,bySeverity:[...severities.map(severity=>({severity,count:severity==='High'?2:severity==='Medium'?1:0,classification:'current'})),{severity:'Legacy',count:1,classification:'historical'}]}}}
}
async function setup(page){
 const state={projects:structuredClone(projects),report:record(),calls:[],unexpected:[]}
 await page.addInitScript(ownerId=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{id:ownerId,email:'owner@reports.test',role:'Developer'},token:'reports-test-token',rememberMe:true},version:0})),ownerId)
 await page.route('**/api/**',r=>{state.unexpected.push(r.request().url());return r.fulfill({status:500,json:{message:'Unexpected fixture request'}})})
 await page.route('**/api/auth/me',r=>r.fulfill({json:{user:{id:ownerId,email:'owner@reports.test',role:'Developer'}}}))
 await page.route('**/api/reports/projects',r=>{
  state.calls.push({url:r.request().url(),method:r.request().method()})
  expect(r.request().headers().authorization).toBe('Bearer reports-test-token')
  return r.fulfill({json:{projects:state.projects}})
 })
 await page.route('**/api/reports/project?*',r=>{
  const projectId=new URL(r.request().url()).searchParams.get('projectId')
  state.calls.push({url:r.request().url(),method:r.request().method()})
  expect(r.request().headers().authorization).toBe('Bearer reports-test-token')
  return r.fulfill({json:{...state.report,project:record(projectId).project}})
 })
 return state
}
async function open(page){await page.goto('/reports');await expect(page.getByRole('button',{name:'Download CSV',exact:true})).toBeVisible()}
test('reports display authoritative metrics, sprint progress, separate reviews and historical severities',async({page},testInfo)=>{
 const state=await setup(page);await open(page)
 for(const [label,value] of [['Total Tasks','150'],['Completed Tasks','70'],['Task Completion','46.67%'],['Code Review Findings','4']])await expect(page.getByRole('article').filter({has:page.getByRole('heading',{name:label,exact:true})})).toContainText(value)
 await expect(page.getByRole('table').getByRole('row').filter({hasText:'Delivery'})).toContainText('77.78%')
 await expect(page.getByRole('table').getByRole('row').filter({hasText:'Empty sprint'})).toContainText('No tasks')
 const reviews=page.getByRole('region',{name:'Saved code review summary'})
 await expect(reviews).toContainText('File review records: 5');await expect(reviews).toContainText('Review batches: 2')
 await expect(reviews).toContainText('Legacy (historical / other)')
 await expect(page.locator('time')).toHaveAttribute('datetime',state.report.asOf)
 for(const name of ['Generate report','View','Download PDF'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0)
 await expect(page.getByText('Weekly engineering digest')).toHaveCount(0)
 expect(state.unexpected).toEqual([]);expect(state.calls.every(c=>c.method==='GET')).toBe(true)
 await page.screenshot({path:testInfo.outputPath('reports-desktop.png'),fullPage:true})
})
test('reports CSV exports the displayed snapshot, escapes text and does not refetch metrics',async({page},testInfo)=>{
 const state=await setup(page)
 state.report.project.name='=SUM(1,2)';state.report.sprints[0].name='Release, "quoted"\n第二行'
 // Keep the response identity canonical while exercising the displayed name.
 await page.route('**/api/reports/project?*',r=>{state.calls.push({url:r.request().url(),method:'GET'});return r.fulfill({json:state.report})})
 await open(page);await expect(page.getByRole('heading',{name:'=SUM(1,2)',exact:true})).toBeVisible()
 state.report.tasks={total:0,toDo:0,inProgress:0,done:0,completionPercent:null}
 const count=state.calls.length,downloadPromise=page.waitForEvent('download')
 await page.getByRole('button',{name:'Download CSV',exact:true}).focus();await page.keyboard.press('Enter')
 const download=await downloadPromise;expect(download.suggestedFilename()).toBe('project-report-alpha.csv')
 const path=testInfo.outputPath('displayed.csv');await download.saveAs(path);const csv=await readFile(path,'utf8')
 expect(csv).toContain('"Tasks","All tasks","","150","70","46.67"')
 expect(csv).toContain('"\'=SUM(1,2)"');expect(csv).toContain('"Release, ""quoted""\n第二行"')
 expect(csv).toContain(state.report.asOf);expect(state.calls.length).toBe(count)
 await page.getByRole('button',{name:'Refresh',exact:true}).click()
 await expect(page.getByRole('article').filter({hasText:'Task Completion'})).toContainText('No tasks')
})
test('reports empty owned project list and real empty metrics have no demo fallback',async({page})=>{
 const state=await setup(page);state.projects=[];await page.goto('/reports')
 await expect(page.getByText('No owned persisted projects.',{exact:false})).toBeVisible()
 await expect(page.getByRole('button',{name:'Download CSV'})).toHaveCount(0)
 state.projects=projects;state.report.tasks={total:0,toDo:0,inProgress:0,done:0,completionPercent:null};state.report.sprints=[]
 state.report.reviews={fileReviews:{total:0,byStatus:[]},batches:{total:0,byStatus:[]},findings:{total:0,bySeverity:severities.map(severity=>({severity,count:0,classification:'current'}))}}
 await page.getByRole('button',{name:'Refresh project list'}).click()
 await expect(page.getByText('No tasks have been saved for this project.')).toBeVisible()
 await expect(page.getByText('No sprints have been saved for this project.')).toBeVisible()
 await expect(page.getByText('No saved finding occurrences in completed reviews.')).toBeVisible()
})
test('reports show project and report loading states without seeded data',async({page})=>{
 await setup(page);let projectsRelease,reportRelease
 await page.route('**/api/reports/projects',async r=>{await new Promise(resolve=>projectsRelease=resolve);await r.fallback()})
 await page.route('**/api/reports/project?*',async r=>{await new Promise(resolve=>reportRelease=resolve);await r.fallback()})
 await page.goto('/reports');await expect(page.getByRole('status')).toContainText('Loading owned projects')
 await expect(page.getByRole('article')).toHaveCount(0);projectsRelease()
 await expect(page.getByRole('status')).toContainText('Loading persisted project report')
 await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeDisabled();reportRelease()
 await expect(page.getByRole('button',{name:'Download CSV'})).toBeVisible()
})
for(const [status,code,text] of [[503,'reports_unavailable','Persisted reporting data is unavailable'],[404,'not_found','no longer own it'],[401,'unauthorized','Session expired']])test(`reports HTTP ${status} clears metrics and offers explicit retry`,async({page})=>{
 await setup(page);await open(page)
 await page.route('**/api/reports/project?*',r=>r.fulfill({status,json:{code,message:'Session expired'}}))
 await page.getByRole('button',{name:'Refresh',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText(text)
 await expect(page.getByRole('article')).toHaveCount(0);await expect(page.getByRole('button',{name:'Download CSV'})).toHaveCount(0)
 await page.route('**/api/reports/project?*',r=>r.fulfill({json:record()}))
 await page.getByRole('button',{name:'Retry report'}).click();await expect(page.getByRole('button',{name:'Download CSV'})).toBeVisible()
})
test('reports network and project-list errors retry without fake zero counts',async({page})=>{
 await setup(page)
 await page.route('**/api/reports/projects',r=>r.abort('failed'));await page.goto('/reports')
 await expect(page.getByRole('alert')).toContainText('Check your connection and retry')
 await page.route('**/api/reports/projects',r=>r.fulfill({json:{projects}}))
 await page.getByRole('button',{name:'Retry projects'}).click();await expect(page.getByRole('button',{name:'Download CSV'})).toBeVisible()
})
for(const endpoint of ['projects','project?*'])test(`reports ${endpoint} timeout is finite and recoverable`,async({page})=>{
 await setup(page);let release
 await page.addInitScript(()=>{const original=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=ms=>original(ms===15000?250:ms)})
 await page.route(`**/api/reports/${endpoint}`,async r=>{await new Promise(resolve=>release=resolve);await r.fallback().catch(()=>{})})
 await page.goto('/reports');await expect(page.getByRole('alert')).toContainText('timed out')
 expect(release).toBeTruthy();release()
 await page.unroute(`**/api/reports/${endpoint}`)
 // unroute removes the setup handler as well; install an explicit valid response.
 await page.route(`**/api/reports/${endpoint}`,r=>r.fulfill({json:endpoint==='projects'?{projects}:record()}))
 await page.getByRole('button',{name:endpoint==='projects'?'Retry projects':'Retry report',exact:true}).click()
 await expect(page.getByRole('button',{name:'Download CSV'})).toBeVisible()
})
test('reports discard stale project and account responses',async({page})=>{
 await setup(page);let held
 await page.route('**/api/reports/project?*',async r=>{
  if(new URL(r.request().url()).searchParams.get('projectId')==='alpha')await new Promise(resolve=>held=resolve)
  await r.fallback()
 })
 await page.goto('/reports');await expect.poll(()=>!!held).toBe(true)
 await page.getByLabel('Owned project').selectOption('beta');held()
 await expect(page.getByRole('heading',{name:'Beta project',exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Alpha project',exact:true})).toHaveCount(0)
 held=null;await page.getByLabel('Owned project').selectOption('alpha');await expect.poll(()=>!!held).toBe(true)
 await page.route('**/api/reports/projects',r=>r.fulfill({json:{projects:[]}}))
 await page.evaluate(async()=>{const {useAuthStore}=await import('/src/store/authStore.js');useAuthStore.setState({user:{id:'other-account',email:'other@reports.test'},token:'other-reports-token'})})
 held();await expect(page.getByText('No owned persisted projects.',{exact:false})).toBeVisible()
 await expect(page.getByRole('button',{name:'Download CSV'})).toHaveCount(0);await expect(page.getByRole('article')).toHaveCount(0)
})
test('reports fail closed for cross-project or inconsistent metrics',async({page})=>{
 const state=await setup(page);await page.route('**/api/reports/project?*',r=>r.fulfill({json:record('foreign')}))
 await page.goto('/reports');await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('article')).toHaveCount(0)
 state.report.tasks.done=999
 await page.route('**/api/reports/project?*',r=>r.fulfill({json:state.report}))
 await page.getByRole('button',{name:'Retry report'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Download CSV'})).toHaveCount(0)
})
test('reports selector, refresh and download are keyboard accessible on a narrow viewport',async({page},testInfo)=>{
 await setup(page);await page.setViewportSize({width:375,height:812});await open(page)
 await page.getByLabel('Owned project').focus();await page.keyboard.press('End');await page.keyboard.press('Enter')
 await expect(page.getByRole('heading',{name:'Beta project',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Refresh',exact:true}).focus();await page.keyboard.press('Enter')
 await expect(page.getByRole('button',{name:'Download CSV'})).toBeVisible()
 await expect(page.getByRole('table').getByRole('columnheader',{name:'Sprint name'})).toBeVisible()
 await page.getByRole('button',{name:'Download CSV'}).focus();await expect(page.getByRole('button',{name:'Download CSV'})).toBeFocused()
 const tableRegion=page.getByRole('region',{name:'Scrollable sprint progress table'})
 await tableRegion.focus();await page.keyboard.press('ArrowRight')
 await expect.poll(()=>tableRegion.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0)
 await page.screenshot({path:testInfo.outputPath('reports-mobile.png'),fullPage:true})
})
test('reporting Dashboard consumer retains the existing summary keys and displays completed counts',async({page})=>{
 await setup(page)
 for(const path of ['projects','tasks','team'])await page.route(`**/api/${path}*`,r=>r.fulfill({json:{projects:[],tasks:[],members:[]}}))
 await page.route('**/api/reports/summary',r=>r.fulfill({json:{generatedAt:'2026-10-26T10:00:00Z',projects:{total:1,byStatus:{Unknown:1}},tasks:{total:3,byStatus:{Done:1},byPriority:{}},sprints:{total:0,byStatus:{}},team:{total:0},reviews:{total:2,savedTotal:3},documents:{total:4,byType:{}},security:{total:0}}}))
 await page.route('**/api/dashboard',r=>r.fulfill({json:{stats:{openTasks:2,criticalHighFindings:0},recentActivity:[]}}))
 await page.route('**/api/security/findings',r=>r.fulfill({json:{findings:[]}}))
 await page.route('**/api/activity?*',r=>r.fulfill({json:{activity:[]}}))
 await page.goto('/dashboard');await expect(page.getByText('2 reviews completed',{exact:true})).toBeVisible();await expect(page.getByText('4 documents generated',{exact:true})).toBeVisible()
})
