import {test,expect} from '@playwright/test'
const projectId='durable-project',batchId='bugs-batch',childId='child-review'
const preview={totalDiscoveredFiles:2,eligibleCandidateCount:2,knownSkippedFileCount:0,totalSourceBytes:20,skipReasons:[]}
const finding={id:'f1',reviewId:childId,findingType:'Bug',severity:'High',file:'src/app.js',line:'1',category:'Logic',problem:'Incorrect branch return',explanation:'The branch returns undefined.',improvement:'Return the computed value.',status:'Open'}
function batch(status='Completed',findings=[finding]){return {id:batchId,projectId,project:'DevNexus Test Project',scope:'Entire Project',options:{focus:'Bugs'},provider:'gemini',batch:true,repository:true,status,findings,findingsCount:findings.length,files:[{fileId:'file-1',path:'src/app.js',status:status==='Queued' ? 'Pending' : 'Reviewed',attempts:1,lines:1,bytes:10,sourceHash:'a'.repeat(64)}],coverage:{submitted:1,pending:status==='Queued' ? 1 : 0,running:0,reviewed:status==='Queued' ? 0 : 1,skipped:0,failed:0},findingsPage:{offset:0,limit:50,total:findings.length,hasMore:false,nextOffset:null}}}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{email:'owner@example.com',role:'Developer'},token:'owner-test-token',rememberMe:true},version:0})))
 await page.route('**/api/**',(r)=>r.fulfill({json:{user:{email:'owner@example.com',role:'Developer'}}}))
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[]}}))
 await page.route('**/api/repository-reviews',(r)=>r.fulfill({json:{reviews:[]}}))
 await page.route('**/api/workspace/projects',(r)=>r.fulfill({json:{projects:[{id:projectId,name:'DevNexus Test Project'}]}}))
 await page.route('**/api/repository-review-batches/preview?*',(r)=>r.fulfill({json:preview}))
})
async function open(page){await page.goto('/security');await page.getByRole('button',{name:'Run Analysis',exact:true}).click();return page.getByRole('dialog')}
test('Bugs entire-project 202 payload and unsupported options',async({page})=>{
 let posts=0
 await page.route('**/api/repository-review-batches',(r)=>{
  if(r.request().method()==='GET')return r.fulfill({json:{batches:[]}})
  posts++;expect(r.request().postDataJSON()).toEqual({projectId,scope:'Entire Project',options:{focus:'Bugs'},idempotencyKey:expect.any(String)})
  return r.fulfill({status:202,json:{batchId,batch:batch('Queued',[])}})
 })
 await page.route(`**/api/repository-review-batches/${batchId}`,(r)=>r.fulfill({json:{batch:batch('Queued',[])}}))
 const dialog=await open(page)
 await expect(dialog.getByLabel('Project',{exact:true})).toHaveValue(projectId)
 for(const name of ['Folder'])await expect(dialog.getByRole('radio',{name,exact:true})).toBeDisabled()
 await expect(dialog.getByRole('radio',{name:'Bugs Only',exact:true})).toBeChecked()
 await expect(dialog.getByRole('checkbox').first()).toBeDisabled()
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Pending 1')
 expect(posts).toBe(1)
})
test('failed submission retains retry key and blocks duplicates while pending',async({page})=>{
 const payloads=[];let release
 await page.route('**/api/repository-review-batches',async(r)=>{
  if(r.request().method()==='GET')return r.fulfill({json:{batches:[]}})
  payloads.push(r.request().postDataJSON());await new Promise((resolve)=>{release=resolve});return r.fulfill({status:503,json:{message:'Storage unavailable.'}})
 })
 const dialog=await open(page)
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(dialog.getByRole('button',{name:'Submitting analysis...'})).toBeDisabled()
 await dialog.locator('form').evaluate((f)=>{f.requestSubmit();f.requestSubmit()})
 await expect.poll(()=>payloads.length).toBe(1);release()
 await expect(dialog.getByRole('alert')).toContainText('Storage unavailable.')
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect.poll(()=>payloads.length).toBe(2);expect(payloads[1]).toEqual(payloads[0]);release()
 await expect(dialog.getByRole('alert')).toContainText('Storage unavailable.')
})
test('loading and empty projects block submissions',async({page})=>{
 let release
 await page.route('**/api/workspace/projects',async(r)=>{await new Promise((resolve)=>{release=resolve});return r.fulfill({json:{projects:[]}})})
 const dialog=await open(page)
 await expect(dialog.getByText('Loading owned projects...')).toBeVisible()
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeDisabled();release()
 await expect(dialog.getByText(/No owned projects found/)).toBeVisible()
 await expect(dialog.locator('#analysis-project option')).toHaveCount(0)
})
for(const status of [401,403,503])test(`project HTTP ${status} has no demo fallback`,async({page})=>{
 await page.route('**/api/workspace/projects',(r)=>r.fulfill({status,json:{message:`Project access failed (${status})`}}))
 const dialog=await open(page)
 await expect(dialog.getByRole('alert')).toHaveText(`Project access failed (${status})`)
 await expect(dialog.locator('#analysis-project option')).toHaveCount(0)
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeDisabled()
})
test('history errors never show seeded findings or fake metrics',async({page})=>{
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({status:503,json:{message:'History unavailable.'}}))
 await page.goto('/security')
 await expect(page.getByRole('alert')).toContainText('History unavailable.')
 await expect(page.getByText('Hard-coded API secret detected')).toHaveCount(0)
 await expect(page.getByRole('region',{name:'Analysis metrics'})).toHaveCount(0)
})
test('saved Bugs history, page counts, null classification and restart navigation',async({page})=>{
 const saved=batch('Completed',[{...finding,findingType:null}])
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[saved,{...saved,id:'general',options:{focus:'General'}}]}}))
 await page.route(`**/api/repository-review-batches/${batchId}`,(r)=>r.fulfill({json:{batch:saved}}))
 await page.goto('/security')
 await expect(page.getByRole('region',{name:'Analysis metrics'})).toContainText('Bugs on loaded page: 0')
 await expect(page.getByRole('region',{name:'Analysis metrics'})).toContainText('Unclassified on loaded page: 1')
 await expect(page.locator('article')).toContainText('Unclassified')
 await expect(page.getByRole('region',{name:'Analysis history'}).getByRole('button',{name:/DevNexus Test Project/})).toHaveCount(1)
 await page.reload();await expect(page.locator('article')).toContainText('Incorrect branch return')
})
test('active progress polls every 15 seconds, shows partial failures and stops after completion',async({page})=>{
 await page.clock.install();let current=batch('Queued',[]),calls=0
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[current]}}))
 await page.route(`**/api/repository-review-batches/${batchId}`,(r)=>{calls++;return r.fulfill({json:{batch:current}})})
 await page.goto('/security');await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Pending 1')
 current={...batch('Partial'),coverage:{submitted:2,pending:0,running:0,reviewed:1,skipped:0,failed:1},files:[...batch().files,{fileId:'fail',path:'src/b.js',status:'Failed',attempts:2,errorCode:'ai_timeout'}]}
 await page.clock.runFor(15000);await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Gemini timed out.')
 const before=calls;await page.clock.runFor(30000);expect(calls).toBe(before)
})
test('pagination, on-demand evidence and persisted triage success/failure',async({page})=>{
 const all=Array.from({length:51},(_,i)=>({...finding,id:`f${i}`,problem:`Incorrect result ${i}`}));const saved={...batch(),findingsCount:51}
 let fail=false;const offsets=[]
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[saved]}}))
 await page.route(`**/api/repository-review-batches/${batchId}*`,(r)=>{const offset=Number(new URL(r.request().url()).searchParams.get('findingOffset') || 0);offsets.push(offset);return r.fulfill({json:{batch:{...saved,findings:all.slice(offset,offset+50),findingsPage:{offset,limit:50,total:51,hasMore:offset===0,nextOffset:50}}}})})
 await page.route(`**/api/repository-reviews/${childId}`,(r)=>r.fulfill({json:{review:{findings:[{...all[50],code:'return value;'}]}}}))
 await page.route(`**/api/repository-reviews/${childId}/findings/f50`,(r)=>{if(fail)return r.fulfill({status:503,json:{message:'Save failed.'}});all[50].status=r.request().postDataJSON().status;return r.fulfill({json:{review:{findings:[all[50]]}}})})
 await page.goto('/security');await expect(page.locator('article')).toHaveCount(50)
 await page.getByRole('button',{name:'Next findings page'}).click()
 await expect(page.locator('article')).toHaveCount(1)
 await expect(page.getByRole('navigation',{name:'Finding pagination'})).toContainText('Page 2 of 2')
 await expect(page.getByRole('region',{name:'Analysis metrics'})).toContainText('Total batch findings: 51')
 await page.getByRole('button',{name:'Load source evidence and suggested fix'}).click()
 await expect(page.getByText('return value;',{exact:true})).toBeVisible()
 await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Fixed')
 await expect(page.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('Fixed')
 fail=true;await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Open')
 await expect(page.getByRole('alert')).toContainText('Finding status was not saved.')
 await expect(page.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('Fixed')
 expect(offsets).toEqual([0,50])
})
test('completed zero-findings analysis is genuine empty output',async({page})=>{
 const saved=batch('Completed',[])
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[saved]}}))
 await page.route(`**/api/repository-review-batches/${batchId}`,(r)=>r.fulfill({json:{batch:saved}}))
 await page.goto('/security');await expect(page.getByText('No findings recorded. This does not establish that the project is bug-free.')).toBeVisible()
 await expect(page.locator('article')).toHaveCount(0)
})
test('Security Only submits Security focus and opens real saved progress',async({page})=>{
 const saved={...batch('Queued',[]),id:'security-batch',options:{focus:'Security'}}
 let posts=0
 await page.route('**/api/repository-review-batches',(r)=>{
  if(r.request().method()==='GET')return r.fulfill({json:{batches:[]}})
  posts++;expect(r.request().postDataJSON()).toEqual({projectId,scope:'Entire Project',options:{focus:'Security'},idempotencyKey:expect.any(String)})
  return r.fulfill({status:202,json:{batchId:saved.id,batch:saved}})
 })
 await page.route('**/api/repository-review-batches/security-batch',(r)=>r.fulfill({json:{batch:saved}}))
 const dialog=await open(page)
 await dialog.getByText('Security Only',{exact:true}).click()
 await expect(dialog.getByRole('radio',{name:'Security Only',exact:true})).toBeChecked()
 await expect(dialog.getByRole('checkbox').first()).toBeDisabled()
 await expect(dialog.getByRole('radio',{name:'Full Analysis',exact:true})).toBeEnabled()
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.getByText(/Selected project:.*Focus: Security/)).toBeVisible()
 await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Pending 1');expect(posts).toBe(1)
})
test('Security retry keys are stable and changing profile creates a new intended request',async({page})=>{
 const payloads=[]
 await page.route('**/api/repository-review-batches',(r)=>{
  if(r.request().method()==='GET')return r.fulfill({json:{batches:[]}})
  payloads.push(r.request().postDataJSON());return r.fulfill({status:503,json:{message:'Temporary request failure.'}})
 })
 const dialog=await open(page)
 await dialog.getByText('Security Only',{exact:true}).click()
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(dialog.getByRole('alert')).toContainText('Temporary request failure.')
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect.poll(()=>payloads.length).toBe(2)
 await expect(dialog.getByRole('alert')).toContainText('Temporary request failure.')
 expect(payloads[1]).toEqual(payloads[0])
 await dialog.getByText('Bugs Only',{exact:true}).click()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect.poll(()=>payloads.length).toBe(3)
 expect(payloads[2].options.focus).toBe('Bugs');expect(payloads[2].idempotencyKey).not.toBe(payloads[0].idempotencyKey)
})
test('saved Security findings and null classifications stay separate from Bugs history',async({page})=>{
 const securityFindings=[{...finding,id:'security-finding',findingType:'Security',problem:'Potential SQL injection',category:'SQL Injection'}, {...finding,id:'legacy-security',findingType:null,problem:'Legacy unclassified finding'}]
 const security={...batch('Completed',securityFindings),id:'security-history',options:{focus:'Security'}}
 const bugs=batch()
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[security,bugs]}}))
 await page.route('**/api/repository-review-batches/security-history',(r)=>r.fulfill({json:{batch:security}}))
 await page.route(`**/api/repository-review-batches/${batchId}`,(r)=>r.fulfill({json:{batch:bugs}}))
 await page.goto('/security')
 await expect(page.getByRole('region',{name:'Analysis metrics'})).toContainText('Security on loaded page: 1')
 await expect(page.getByRole('region',{name:'Analysis metrics'})).toContainText('Unclassified on loaded page: 1')
 await expect(page.getByRole('region',{name:'Analysis metrics'})).toContainText('Bugs on loaded page: 0')
 await expect(page.locator('article')).toHaveCount(2)
 await expect(page.getByRole('region',{name:'Analysis history'}).getByRole('button',{name:/DevNexus Test Project.*Bugs/})).toHaveCount(0)
 await page.getByRole('button',{name:'Bugs analyses',exact:true}).click()
 await expect(page.locator('article')).toHaveCount(1)
 await expect(page.locator('article')).toContainText('Incorrect branch return')
 await expect(page.getByRole('region',{name:'Analysis history'}).getByRole('button',{name:/DevNexus Test Project.*Security/})).toHaveCount(0)
 await page.getByRole('button',{name:'Security analyses',exact:true}).click()
 await expect(page.locator('article')).toHaveCount(2)
 await page.reload();await expect(page.locator('article')).toHaveCount(2)
 await expect(page.getByText('Hard-coded API secret detected')).toHaveCount(0)
})
test('zero findings from Security does not claim the project is secure',async({page})=>{
 const saved={...batch('Completed',[]),options:{focus:'Security'}}
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[saved]}}))
 await page.route(`**/api/repository-review-batches/${batchId}`,(r)=>r.fulfill({json:{batch:saved}}))
 await page.goto('/security')
 await expect(page.getByText('No security findings recorded. This does not establish that the project is secure.')).toBeVisible()
 await expect(page.locator('article')).toHaveCount(0)
})
test('Full Analysis maps to BugsAndSecurity with supported Entire Project payload',async({page})=>{
 const saved={...batch('Queued',[]),options:{focus:'BugsAndSecurity'}}
 let posts=0
 await page.route('**/api/repository-review-batches',(r)=>{
  if(r.request().method()==='GET')return r.fulfill({json:{batches:[]}})
  posts++;expect(r.request().postDataJSON()).toEqual({projectId,scope:'Entire Project',options:{focus:'BugsAndSecurity'},idempotencyKey:expect.any(String)})
  return r.fulfill({status:202,json:{batchId,batch:saved}})
 })
 await page.route(`**/api/repository-review-batches/${batchId}`,(r)=>r.fulfill({json:{batch:saved}}))
 const dialog=await open(page)
 await dialog.getByText('Full Analysis',{exact:true}).click()
 await expect(dialog.getByRole('radio',{name:'Full Analysis',exact:true})).toBeChecked()
 await expect(dialog.getByRole('radio',{name:'Folder',exact:true})).toBeDisabled()
 await expect(dialog.getByRole('radio',{name:'Single File',exact:true})).toBeEnabled()
 for(const checkbox of await dialog.getByRole('checkbox').all())await expect(checkbox).toBeDisabled()
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.getByText(/Selected project:.*Focus: Full Analysis/)).toBeVisible()
 await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Pending 1');expect(posts).toBe(1)
})
test('Full retry keys stay stable and cannot be reused for a changed profile',async({page})=>{
 const payloads=[];let release
 await page.route('**/api/repository-review-batches',async(r)=>{
  if(r.request().method()==='GET')return r.fulfill({json:{batches:[]}})
  payloads.push(r.request().postDataJSON());await new Promise(resolve=>{release=resolve});return r.fulfill({status:503,json:{message:'Submission failed.'}})
 })
 const dialog=await open(page);await dialog.getByText('Full Analysis',{exact:true}).click()
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(dialog.getByRole('button',{name:'Submitting analysis...'})).toBeDisabled()
 await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
 await expect.poll(()=>payloads.length).toBe(1);release()
 await expect(dialog.getByRole('alert')).toContainText('Submission failed.')
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect.poll(()=>payloads.length).toBe(2);expect(payloads[1]).toEqual(payloads[0]);release()
 await expect(dialog.getByRole('alert')).toContainText('Submission failed.')
 await dialog.getByText('Security Only',{exact:true}).click()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect.poll(()=>payloads.length).toBe(3);expect(payloads[2].options.focus).toBe('Security');expect(payloads[2].idempotencyKey).not.toBe(payloads[0].idempotencyKey);release()
 await expect(dialog.getByRole('alert')).toContainText('Submission failed.')
})
test('Full history separates profiles and preserves Bug, Security and null classifications',async({page})=>{
 const full={...batch('Completed',[finding,{...finding,id:'sec',findingType:'Security',category:'SQL Injection',problem:'Potential SQL injection'},{...finding,id:'legacy',findingType:null,category:'Security',problem:'Unclassified historical finding'}]),options:{focus:'BugsAndSecurity'}}
 const bugs={...batch(),id:'bugs-only'},security={...batch('Completed',[{...finding,findingType:'Security'}]),id:'security-only',options:{focus:'Security'}}
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[full,bugs,security]}}))
 for(const saved of [full,bugs,security])await page.route(`**/api/repository-review-batches/${saved.id}`,(r)=>r.fulfill({json:{batch:saved}}))
 await page.goto('/security')
 await expect(page.getByRole('button',{name:'Full Analysis',exact:true})).toHaveAttribute('aria-pressed','true')
 await expect(page.locator('article')).toHaveCount(3)
 const metrics=page.getByRole('region',{name:'Analysis metrics'})
 await expect(metrics).toContainText('Bugs on loaded page: 1');await expect(metrics).toContainText('Security on loaded page: 1');await expect(metrics).toContainText('Unclassified on loaded page: 1')
 await page.getByRole('combobox',{name:'Filter by type'}).selectOption('Unclassified')
 await expect(page.locator('article')).toHaveCount(1);await expect(page.locator('article')).toContainText('Unclassified')
 await page.getByRole('button',{name:'Bugs analyses',exact:true}).click();await expect(page.locator('article')).toHaveCount(1)
 await page.getByRole('button',{name:'Security analyses',exact:true}).click();await expect(page.locator('article')).toHaveCount(1)
 await page.getByRole('button',{name:'Full Analysis',exact:true}).click();await expect(page.locator('article')).toHaveCount(3)
 await page.reload();await expect(page.locator('article')).toHaveCount(3)
})
for(const status of ['Completed','Partial','Failed','Queued','In Progress'])test(`Full Analysis renders ${status} coverage without claiming unreviewed files were analyzed`,async({page})=>{
 const saved={...batch(status,[]),options:{focus:'BugsAndSecurity'}}
 if(status==='Partial'){saved.coverage={submitted:2,pending:0,running:0,reviewed:1,skipped:1,failed:0};saved.files.push({fileId:'skip',path:'large.js',status:'Skipped',attempts:0,errorCode:'source_limit',skipReason:{message:'Source exceeds review limits.'}})}
 if(status==='Failed'){saved.coverage={submitted:1,pending:0,running:0,reviewed:0,skipped:0,failed:1};saved.files[0]={...saved.files[0],status:'Failed',attempts:2,errorCode:'ai_unavailable'}}
 if(status==='In Progress'){saved.coverage={submitted:1,pending:0,running:1,reviewed:0,skipped:0,failed:0};saved.files[0].status='Running'}
 await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[saved]}}))
 await page.route(`**/api/repository-review-batches/${batchId}`,(r)=>r.fulfill({json:{batch:saved}}))
 await page.goto('/security');await expect(page.getByRole('region',{name:'Batch progress'})).toContainText(`Batch: ${status}`)
 await expect(page.locator('article')).toHaveCount(0)
 if(status==='Completed')await expect(page.getByText('No findings recorded. This does not establish that the project is bug-free or secure.')).toBeVisible()
 if(status==='Partial')await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Source exceeds review limits.')
 if(status==='Failed')await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('No files were successfully reviewed.')
 if(status==='In Progress')await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Running 1')
})
const singleFileId='00000000-0000-4000-8000-000000000111'
function singleReview(focus='Bugs',findings=[finding]){return {id:'single-review',projectId,project:'DevNexus Test Project',fileId:singleFileId,file:'src/one.js',scope:'src/one.js',provider:'gemini',repository:true,options:{focus},status:'Completed',coverage:{scope:'Single File',filesReviewed:1,filesSubmitted:1,lines:2,bytes:20},findings:findings.map(f=>({...f,file:'src/one.js',code:'return item.value;',reviewId:undefined})),findingsCount:findings.length}}
async function openSingle(page){
 await page.route(`**/api/workspace/projects/${projectId}/files`,r=>r.fulfill({json:{files:[{id:singleFileId,path:'src/one.js'}]}}))
 const dialog=await open(page);await dialog.getByText('Single File',{exact:true}).click()
 return dialog
}
for(const [label,focus,type] of [['Bugs Only','Bugs','Bug'],['Security Only','Security','Security'],['Full Analysis','BugsAndSecurity','Security']])test(`Single File ${label} submits authoritative IDs and exact contract`,async({page})=>{
 const saved=singleReview(focus,[{...finding,findingType:type}]);let posts=0
 await page.route('**/api/repository-reviews',r=>{
  if(r.request().method()==='GET')return r.fulfill({json:{reviews:[]}})
  posts++;expect(r.request().postDataJSON()).toEqual({projectId,fileId:singleFileId,options:{focus}})
  return r.fulfill({status:201,json:{review:saved}})
 })
 await page.route('**/api/repository-reviews/single-review',r=>r.fulfill({json:{review:saved}}))
 const dialog=await openSingle(page)
 if(label!=='Bugs Only')await dialog.getByText(label,{exact:true}).click()
 await expect(dialog.getByRole('combobox',{name:'Uploaded source file'})).toHaveValue(singleFileId)
 await expect(dialog.getByRole('radio',{name:'Folder',exact:true})).toBeDisabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.getByRole('region',{name:'Single file progress'})).toContainText('Single File: Completed')
 await expect(page.locator('article')).toContainText(type)
 await expect(page.getByRole('region',{name:'Analysis history'})).toContainText('Single File: src/one.js')
 await expect(page.getByRole('navigation',{name:'Finding pagination'})).toHaveCount(0)
 expect(posts).toBe(1)
})
test('Single File loading, empty files and unauthorized listing never submit stale selection',async({page})=>{
 let release,response={json:{files:[]}}
 await page.route(`**/api/workspace/projects/${projectId}/files`,async r=>{await new Promise(resolve=>{release=resolve});return r.fulfill(response)})
 const dialog=await open(page);await dialog.getByText('Single File',{exact:true}).click()
 await expect(dialog.getByText('Loading uploaded files...')).toBeVisible()
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeDisabled();release()
 await expect(dialog.getByText('No uploaded source files in this project.')).toBeVisible()
 response={status:403,json:{message:'File access denied.'}}
 await dialog.getByRole('button',{name:'Refresh files'}).click()
 await expect(dialog.getByText('Loading uploaded files...')).toBeVisible();release()
 await expect(dialog.getByRole('alert')).toContainText('File access denied.')
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeDisabled()
})
test('changing owned project cannot reuse another project file ID',async({page})=>{
 await page.route('**/api/workspace/projects',r=>r.fulfill({json:{projects:[{id:projectId,name:'DevNexus Test Project'},{id:'another-owned',name:'Other owned project'}]}}))
 await page.route('**/api/workspace/projects/another-owned/files',r=>r.fulfill({json:{files:[]}}))
 const dialog=await openSingle(page)
 await expect(dialog.getByRole('combobox',{name:'Uploaded source file'})).toHaveValue(singleFileId)
 await dialog.getByLabel('Project',{exact:true}).selectOption('another-owned')
 await expect(dialog.getByText('No uploaded source files in this project.')).toBeVisible()
 await expect(dialog.getByRole('combobox',{name:'Uploaded source file'})).toBeDisabled()
 await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeDisabled()
})
test('single-file saved history, source evidence and triage survive reload',async({page})=>{
 let saved=singleReview()
 await page.route('**/api/repository-reviews',r=>r.fulfill({json:{reviews:[saved]}}))
 await page.route('**/api/repository-reviews/single-review',r=>r.fulfill({json:{review:saved}}))
 await page.route('**/api/repository-reviews/single-review/findings/f1',r=>{expect(r.request().postDataJSON()).toEqual({status:'Fixed'});saved={...saved,findings:saved.findings.map(f=>({...f,status:'Fixed'}))};return r.fulfill({json:{review:saved}})})
 await page.goto('/security')
 await expect(page.getByText('return item.value;',{exact:true})).toBeVisible()
 await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Fixed')
 await expect(page.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('Fixed')
 await page.reload();await expect(page.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('Fixed')
})
test('single-file zero findings stays empty and provider failure never becomes fake success',async({page})=>{
 const saved=singleReview('Bugs',[]);let failed=false
 await page.route('**/api/repository-reviews',r=>r.fulfill(r.request().method()==='GET' ? {json:{reviews:[]}} : failed ? {status:504,json:{message:'Gemini request timed out.',code:'ai_timeout'}} : {status:201,json:{review:saved}}))
 await page.route('**/api/repository-reviews/single-review',r=>r.fulfill({json:{review:saved}}))
 let dialog=await openSingle(page);await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(page.getByText('No findings recorded. This does not establish that the project is bug-free.')).toBeVisible()
 failed=true;await page.getByRole('button',{name:'Run Analysis',exact:true}).click();dialog=page.getByRole('dialog')
 await dialog.getByText('Single File',{exact:true}).click();await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(dialog.getByRole('alert')).toContainText('Gemini request timed out.')
 await expect(dialog.getByRole('alert')).toContainText('do not support server idempotency')
 await expect(page.locator('article')).toHaveCount(0)
})
test('single-file duplicate submits are prevented while waiting for synchronous generation',async({page})=>{
 let posts=0,release
 await page.route('**/api/repository-reviews',async r=>{
  if(r.request().method()==='GET')return r.fulfill({json:{reviews:[]}})
  posts++;await new Promise(resolve=>{release=resolve});return r.fulfill({status:503,json:{message:'Gemini unavailable.'}})
 })
 const dialog=await openSingle(page);await expect(dialog.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled()
 await dialog.getByRole('button',{name:'Run Analysis',exact:true}).click()
 await expect(dialog.getByRole('button',{name:'Submitting analysis...'})).toBeDisabled()
 await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
 await expect.poll(()=>posts).toBe(1);release()
 await expect(dialog.getByRole('alert')).toContainText('Gemini unavailable.');expect(posts).toBe(1)
})
