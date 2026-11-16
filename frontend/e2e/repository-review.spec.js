import {test,expect} from '@playwright/test'
const projectId='uploaded-project',fileId='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002'
const finding={id:'finding-1',file:'src/app.js',line:'1',severity:'High',category:'Security',problem:'Dynamic execution.',explanation:'Untrusted input may execute.',improvement:'Use a parser.',code:'eval(input)',suggestedCode:'',status:'Open'}
const review={id,projectId,fileId,project:'Uploaded project',file:'src/app.js',scope:'src/app.js',provider:'gemini',status:'Completed',repository:true,findings:[finding],findingsCount:1,coverage:{filesReviewed:1,lines:1,bytes:11,truncated:false}}
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{email:'review@example.com',name:'Reviewer',role:'Developer'},token:'test-real-session',rememberMe:true},version:0}));const original=AbortSignal.timeout;AbortSignal.timeout=(ms)=>{window.reviewTimeout=ms;return original(ms)}})
  await page.route('**/api/**',(route)=>route.fulfill({json:{user:{email:'review@example.com',role:'Developer'}}}))
  await page.route('**/api/repository-reviews',(route)=>route.fulfill({json:{reviews:[]}}))
  await page.route('**/api/repository-review-batches',(route)=>route.fulfill({json:{batches:[]}}))
  await page.route('**/api/workspace/projects',(route)=>route.fulfill({json:{projects:[{id:projectId,name:'Uploaded project'}]}}))
  await page.route(`**/api/workspace/projects/${projectId}/files`,(route)=>route.fulfill({json:{files:[{id:fileId,path:'src/app.js'}]}}))
})
test('review uses real selections, submits IDs/options only, labels Gemini correctly and saves triage',async({page})=>{
  await page.route('**/api/repository-reviews',async(route)=>{
    if(route.request().method()==='GET')return route.fulfill({json:{reviews:[]}})
    expect(route.request().postDataJSON()).toEqual({projectId,fileId,options:{focus:'General'}})
    return route.fulfill({json:{review}})
  })
  await page.route(`**/api/repository-reviews/${id}/findings/finding-1`,(route)=>{
    expect(route.request().postDataJSON()).toEqual({status:'Fixed'})
    return route.fulfill({json:{review:{...review,findings:[{...finding,status:'Fixed'}]}}})
  })
  await page.goto('/code-review')
  await page.getByRole('button',{name:'Start Review',exact:true}).click()
  await expect(page.getByLabel('Uploaded source file',{exact:true})).toHaveValue(fileId)
  await page.getByRole('button',{name:'Start Code Review',exact:true}).click()
  await expect(page.getByText('Dynamic execution.',{exact:true})).toBeVisible()
  await expect(page.getByText('AI-generated review',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>window.reviewTimeout)).toBe(110000)
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Fixed')
  await expect(page.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('Fixed')
})
test('Gemini error remains an error with no fake successful review',async({page})=>{
  await page.route('**/api/repository-reviews',(route)=>route.fulfill(route.request().method()==='GET' ? {json:{reviews:[]}} : {status:504,json:{message:'Gemini request timed out. Try again.',code:'ai_timeout'}}))
  await page.goto('/code-review')
  await page.getByRole('button',{name:'Start Review',exact:true}).click()
  await expect(page.getByLabel('Uploaded source file',{exact:true})).toHaveValue(fileId)
  await page.getByRole('button',{name:'Start Code Review',exact:true}).click()
  await expect(page.getByText('Gemini request timed out. Try again.',{exact:true})).toBeVisible()
  await expect(page.getByText('Dynamic execution.',{exact:true})).toHaveCount(0)
})

test('three-file background selection, actual progress, partial findings and persisted child triage survive reload',async({page})=>{
  await page.clock.install()
  const ids=[fileId,'00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005']
  const files=ids.map((fileId,i)=>({fileId,path:`src/${['app.js','b.ts','c.js','d.js'][i]}`,sourceHash:'a'.repeat(64),bytes:11,lines:1,status:'Pending',attempts:0}))
  let current,posts=0
  const batchId='00000000-0000-4000-8000-000000000010'
  await page.route(`**/api/workspace/projects/${projectId}/files`,(route)=>route.fulfill({json:{files:files.map((f)=>({id:f.fileId,path:f.path}))}}))
  await page.route('**/api/repository-review-batches',async(route)=>{
    if(route.request().method()==='GET')return route.fulfill({json:{batches:current ? [current] : []}})
    posts++
    const payload=route.request().postDataJSON()
    expect(payload).toEqual({projectId,fileIds:ids.slice(0,3),options:{focus:'General'},idempotencyKey:expect.any(String)})
    current={id:batchId,projectId,project:'Uploaded project',batch:true,repository:true,provider:'gemini',model:'test-model',scope:'Selected Files',status:'Queued',files:files.slice(0,3),findings:[],findingsCount:0,coverage:{submitted:3,pending:3,running:0,reviewed:0,skipped:0,failed:0}}
    return route.fulfill({status:202,json:{batchId,batch:current}})
  })
  await page.route(`**/api/repository-review-batches/${batchId}`,(route)=>route.fulfill({json:{batch:current}}))
  await page.route(`**/api/repository-reviews/${id}/findings/finding-1`,(route)=>{
    current={...current,findings:current.findings.map((f)=>({...f,status:'Fixed'}))}
    return route.fulfill({json:{review:{...review,findings:[{...finding,status:'Fixed'}]}}})
  })
  await page.goto('/code-review')
  await page.getByRole('button',{name:'Start Review',exact:true}).click()
  await page.getByLabel('Review mode').selectOption('batch')
  for(const file of files.slice(0,3))await page.getByRole('checkbox',{name:file.path,exact:true}).check()
  await expect(page.getByRole('checkbox',{name:files[3].path,exact:true})).toBeDisabled()
  await expect(page.getByText('Selected: src/app.js, src/b.ts, src/c.js',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Start Code Review',exact:true}).click()
  await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Submitted 3 · Pending 3')
  current={...current,status:'Partial',coverage:{submitted:3,pending:0,running:0,reviewed:1,skipped:1,failed:1},files:current.files.map((f,i)=>({...f,status:['Reviewed','Failed','Skipped'][i],attempts:i===1 ? 2 : 1,reviewId:i===0 ? id : null,errorCode:i===1 ? 'ai_timeout' : i===2 ? 'source_changed' : null})),findings:[{...finding,reviewId:id,fileId,sourceHash:files[0].sourceHash}],findingsCount:1}
  await page.clock.runFor(15000)
  await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Reviewed 1 · Skipped 1 · Failed 1')
  await expect(page.getByText('Dynamic execution.',{exact:true})).toBeVisible()
  await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Gemini timed out.')
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Fixed')
  await page.reload()
  await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Batch: Partial')
  await expect(page.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('Fixed')
  expect(posts).toBe(1)
})
const preview={totalDiscoveredFiles:4,eligibleCandidateCount:3,knownSkippedFileCount:1,totalSourceBytes:100,skipReasons:[{code:'source_character_limit',count:1,message:'Too many characters.'}]}
async function openProject(page){await page.goto('/code-review');await page.getByRole('button',{name:'Start Review',exact:true}).click();await page.getByLabel('Review mode').selectOption('project')}
test('project preview counts, caching and mode compatibility',async({page})=>{
  let calls=0
  await page.route('**/api/repository-review-batches/preview?*',(r)=>{calls++;return r.fulfill({json:preview})})
  await openProject(page)
  const panel=page.getByRole('region',{name:'Project review preview'})
  await expect(panel).toContainText('Eligible candidates: 3')
  await expect(panel).toContainText('Known excluded files: 1')
  await expect(panel).toContainText('Eligibility is preliminary')
  await expect(panel).toContainText('200 files and 10 MiB')
  await page.getByLabel('Review mode').selectOption('single')
  await expect(page.getByLabel('Uploaded source file',{exact:true})).toHaveValue(fileId)
  await page.getByLabel('Review mode').selectOption('project')
  await expect(panel).toContainText('Discovered files: 4');expect(calls).toBe(1)
})
test('empty and failed previews block submission',async({page})=>{
  let failed=false
  await page.route('**/api/repository-review-batches/preview?*',(r)=>r.fulfill(failed ? {status:413,json:{message:'Project exceeds discovery limits.'}} : {json:{...preview,totalDiscoveredFiles:0,eligibleCandidateCount:0,knownSkippedFileCount:0,skipReasons:[]}}))
  await openProject(page)
  await expect(page.getByText('This project has no uploaded source files.')).toBeVisible()
  await expect(page.getByRole('button',{name:'Start Code Review',exact:true})).toBeDisabled()
  failed=true;await page.getByRole('button',{name:'Refresh preview'}).click()
  await expect(page.getByText('Project exceeds discovery limits.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Start Code Review',exact:true})).toBeDisabled()
})
test('whole-project payload and stable retry key; submission is disabled in flight',async({page})=>{
  const payloads=[];let release
  await page.route('**/api/repository-review-batches/preview?*',(r)=>r.fulfill({json:preview}))
  await page.route('**/api/repository-review-batches',async(r)=>{
    if(r.request().method()==='GET')return r.fulfill({json:{batches:[]}})
    payloads.push(r.request().postDataJSON());await new Promise((resolve)=>{release=resolve});return r.fulfill({status:503,json:{message:'Temporary failure.'}})
  })
  await openProject(page);await expect(page.getByText('Eligible candidates: 3')).toBeVisible()
  await page.getByRole('button',{name:'Start Code Review',exact:true}).click()
  await expect(page.getByRole('button',{name:'Submitting review...'})).toBeDisabled()
  await expect.poll(()=>payloads.length).toBe(1);release()
  await expect(page.getByText('Temporary failure.',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Start Code Review',exact:true}).click()
  await expect.poll(()=>payloads.length).toBe(2)
  expect(payloads[0]).toEqual({projectId,scope:'Entire Project',options:{focus:'General'},idempotencyKey:expect.any(String)})
  expect(payloads[1]).toEqual(payloads[0]);release()
  await expect(page.getByText('Temporary failure.',{exact:true})).toBeVisible()
})
test('project history loads manifest, paginates and preserves current page while polling',async({page})=>{
  await page.clock.install()
  const batchId='whole-project',offsets=[]
  const all=Array.from({length:51},(_,i)=>({...finding,id:`issue-${i}`,problem:`Issue ${i}`,reviewId:id,code:undefined}))
  const batch={id:batchId,project:'Uploaded project',scope:'Entire Project',batch:true,repository:true,provider:'gemini',status:'Partial',files:[],findingsCount:51,coverage:{submitted:2,pending:0,running:0,reviewed:1,skipped:1,failed:0}}
  await page.route('**/api/repository-review-batches',(r)=>r.fulfill({json:{batches:[batch]}}))
  await page.route(`**/api/repository-review-batches/${batchId}*`,(r)=>{
    const offset=Number(new URL(r.request().url()).searchParams.get('findingOffset') || 0);offsets.push(offset)
    return r.fulfill({json:{batch:{...batch,files:[{fileId,path:'src/app.js',status:'Reviewed',attempts:1},{fileId:'skip',path:'large.ts',status:'Skipped',attempts:0,errorCode:'source_character_limit',skipReason:{message:'Too many characters.'}}],findings:all.slice(offset,offset+50),findingsPage:{offset,limit:50,total:51,hasMore:offset===0,nextOffset:offset===0 ? 50 : null}}}})
  })
  await page.route(`**/api/repository-reviews/${id}`,(r)=>r.fulfill({json:{review:{...review,findings:[{...all[50],code:'const result = 1'}]}}}))
  await page.route(`**/api/repository-reviews/${id}/findings/issue-50`,(r)=>{all[50].status='Fixed';return r.fulfill({json:{review:{...review,findings:[all[50]]}}})})
  await page.goto('/code-review')
  await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Entire Project')
  await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Too many characters.')
  await page.getByRole('button',{name:'Next findings page'}).click()
  await expect(page.getByRole('navigation',{name:'Finding pagination'})).toContainText('Page 2 of 2')
  await expect(page.getByText('Issue 50',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Load source evidence and suggested fix'}).click()
  await expect(page.getByText('const result = 1',{exact:true})).toBeVisible()
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Fixed')
  await expect(page.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('Fixed')
  const before=offsets.length;await page.clock.runFor(15000)
  await expect.poll(()=>offsets.length).toBeGreaterThan(before);expect(offsets.at(-1)).toBe(50)
  await page.reload();await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Entire Project')
})
test('HTTP 202 entire-project submission opens durable progress and new setup has a fresh key',async({page})=>{
  const keys=[]
  await page.route('**/api/repository-review-batches/preview?*',(r)=>r.fulfill({json:preview}))
  await page.route('**/api/repository-review-batches',async(r)=>{
    if(r.request().method()==='GET')return r.fulfill({json:{batches:[]}})
    keys.push(r.request().postDataJSON().idempotencyKey)
    return r.fulfill({status:202,json:{batchId:'accepted',batch:{id:'accepted',project:'Uploaded project',scope:'Entire Project',batch:true,repository:true,provider:'gemini',status:'Queued',files:[],findings:[],findingsCount:0,coverage:{submitted:4,pending:3,running:0,reviewed:0,skipped:1,failed:0}}}})
  })
  await openProject(page);await expect(page.getByText('Eligible candidates: 3')).toBeVisible()
  await page.getByRole('button',{name:'Start Code Review',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Entire Project')
  await expect(page.getByRole('region',{name:'Batch progress'})).toContainText('Pending 3')
  await page.getByRole('button',{name:'Start Review',exact:true}).click()
  await page.getByLabel('Review mode').selectOption('project')
  await expect(page.getByText('Eligible candidates: 3')).toBeVisible()
  await page.getByRole('button',{name:'Start Code Review',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(keys).toHaveLength(2);expect(keys[1]).not.toBe(keys[0])
})
test('preview loading and keyboard dialog behavior; all-excluded projects cannot submit',async({page})=>{
  let release
  await page.route('**/api/repository-review-batches/preview?*',async(r)=>{await new Promise((resolve)=>{release=resolve});return r.fulfill({json:{...preview,eligibleCandidateCount:0,knownSkippedFileCount:4,skipReasons:[{code:'source_character_limit',count:4,message:'Too many characters.'}]}})})
  await openProject(page)
  await expect(page.getByText('Loading project preview...')).toBeVisible()
  await expect(page.getByRole('button',{name:'Start Code Review',exact:true})).toBeDisabled()
  release()
  await expect(page.getByText('No eligible candidate files to review.')).toBeVisible()
  await expect(page.getByRole('button',{name:'Start Code Review',exact:true})).toBeDisabled()
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Start Review',exact:true})).toBeFocused()
})
