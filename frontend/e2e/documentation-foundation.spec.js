import {test,expect} from '@playwright/test'
const projects=[{id:'owned-docs',name:'DevNexus Test Project'},{id:'second-owned',name:'Other owned project'}]
const doc={id:'11111111-1111-4111-8111-111111111111',projectId:'owned-docs',creatorId:'owner',documentType:'project-overview',title:'Saved Project Overview',generationStatus:'Completed',provider:'gemini',model:'test-model',createdAt:'2026-10-15T10:00:00Z',updatedAt:'2026-10-15T10:00:00Z',failureCode:null,markdown:'# Project Overview\n\nObserved greet function. [Source: src/app.js, lines 1-2]',sourceReferences:[{fileId:'22222222-2222-4222-8222-222222222222',path:'src/app.js',hash:'a'.repeat(64),byteSize:40,lineRanges:[{lineStart:1,lineEnd:2}]}],coverage:{filesSubmitted:1,filesIncluded:1,filesSkipped:0,filesFailed:0,truncated:false}}
function history(r,documents=[]){const url=new URL(r.request().url()),offset=Number(url.searchParams.get('offset'));return r.fulfill({json:{documents:documents.slice(offset,offset+20).map(({markdown: _markdown,...item})=>item),total:documents.length,limit:20,offset}})}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{email:'docs-owner@example.com',role:'Developer'},token:'docs-test-token',rememberMe:true},version:0})))
 await page.route('**/api/**',r=>r.fulfill({json:{user:{email:'docs-owner@example.com',role:'Developer'}}}))
 await page.route('**/api/workspace/projects',r=>r.fulfill({json:{projects}}))
 await page.route('**/api/project-documents?*',r=>history(r))
 await page.route('**/api/project-documents/'+doc.id,r=>r.fulfill({json:{document:doc}}))
})
async function open(page){await page.goto('/documentation');await expect(page.getByRole('region',{name:'Saved documentation'})).toContainText('No saved documentation');await page.getByRole('button',{name:'Documentation Setup',exact:true}).click();return page.getByRole('dialog')}

test('documentation uses real project IDs; only Project Overview and no detailed options enabled',async({page})=>{
 await page.route('**/api/workspace/projects',r=>{expect(r.request().headers().authorization).toBe('Bearer docs-test-token');return r.fulfill({json:{projects}})})
 const dialog=await open(page)
 await expect(dialog.getByLabel('Project',{exact:true})).toHaveValue('owned-docs')
 await dialog.getByLabel('Project',{exact:true}).selectOption('second-owned')
 await expect(dialog.getByLabel('Project',{exact:true})).toHaveValue('second-owned')
 await expect(dialog.getByLabel('Document Type',{exact:true})).toHaveValue('project-overview')
 await expect(dialog.locator('#gen-doc-type option[value="project-overview"]')).toBeEnabled()
 for(const option of await dialog.locator('#gen-doc-type option:not([value="project-overview"])').all())await expect(option).toBeDisabled()
 for(const checkbox of await dialog.getByRole('checkbox').all())await expect(checkbox).toBeDisabled()
 await expect(page.getByText('E-Commerce Platform',{exact:true})).toHaveCount(0)
})
test('documentation loading and empty projects prevent generation',async({page})=>{
 let release
 await page.route('**/api/workspace/projects',async r=>{await new Promise(resolve=>{release=resolve});await r.fulfill({json:{projects:[]}})})
 await page.goto('/documentation');await expect(page.getByText('Loading owned projects...')).toBeVisible()
 await expect(page.getByLabel('Documentation project',{exact:true})).toBeDisabled();release()
 await expect(page.getByText(/No owned projects found/)).toBeVisible()
 await page.getByRole('button',{name:'Documentation Setup',exact:true}).click()
 await expect(page.getByRole('dialog').getByRole('button',{name:'Generate Documentation',exact:true})).toBeDisabled()
})
for(const status of [401,403,503])test(`documentation project HTTP ${status} is explicit and retry does not use demo fallback`,async({page})=>{
 let fail=true
 await page.route('**/api/workspace/projects',r=>r.fulfill(fail ? {status,json:{message:`Projects unavailable (${status})`}} : {json:{projects}}))
 await page.goto('/documentation');await expect(page.getByRole('alert')).toHaveText(`Projects unavailable (${status})`)
 await expect(page.locator('#documentation-project option')).toHaveCount(0)
 fail=false;await page.getByRole('button',{name:'Retry project loading'}).click()
 await expect(page.getByLabel('Documentation project')).toHaveValue('owned-docs')
})
test('documentation malformed project listing rejected',async({page})=>{
 await page.route('**/api/workspace/projects',r=>r.fulfill({json:{projects:[{name:'Missing durable ID'}]}}))
 await page.goto('/documentation');await expect(page.getByRole('alert')).toHaveText('Invalid project listing response.')
})
test('documentation generation posts exact owned payload once and displays Completed saved source references',async({page})=>{
 let release,posts=0,saved=false
 await page.route('**/api/project-documents?*',r=>history(r,saved?[doc]:[]))
 await page.route('**/api/project-documents/generate',async r=>{
  posts++;expect(r.request().headers().authorization).toBe('Bearer docs-test-token')
  expect(r.request().postDataJSON()).toEqual({projectId:'owned-docs',documentType:'project-overview',requestId:expect.stringMatching(/^[0-9a-f-]{36}$/)})
  await new Promise(resolve=>{release=resolve});saved=true;await r.fulfill({status:201,json:{document:doc}})
 })
 const dialog=await open(page)
 await expect(page.getByText('Generation: Ready',{exact:true})).toBeVisible()
 await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
 await expect(dialog.getByRole('button',{name:'Generating...',exact:true})).toBeDisabled()
 await expect(page.getByText('Generation: Pending',{exact:true})).toBeVisible()
 await expect(page.getByLabel('Documentation project')).toBeDisabled()
 await expect.poll(()=>posts).toBe(1);release()
 await expect(page.getByText('Generation: Completed',{exact:true})).toBeVisible()
 const preview=page.getByRole('region',{name:'Document preview'})
 await expect(preview).toContainText('test-model');await expect(preview).toContainText('src/app.js');await expect(preview).toContainText('Lines 1-2');await expect(preview).toContainText('a'.repeat(64));await expect(preview).toContainText('Submitted: 1 ? Included: 1 ? Skipped: 0 ? Failed: 0')
 await expect(page.getByRole('region',{name:'Saved documentation'})).toContainText('Saved Project Overview')
 await page.reload();await expect(page.getByRole('region',{name:'Saved documentation'})).toContainText('Saved Project Overview')
 expect(posts).toBe(1)
})
test('documentation Gemini failure refreshes durable Failed history with no fallback',async({page})=>{
 let saved=false,posts=0
 const failed={...doc,generationStatus:'Failed',failureCode:'ai_unavailable',markdown:''}
 await page.route('**/api/project-documents?*',r=>history(r,saved?[failed]:[]))
 await page.route('**/api/project-documents/generate',r=>{posts++;saved=true;return r.fulfill({status:503,json:{code:'ai_unavailable',message:'Gemini service is unavailable. Try again later.',documentId:doc.id,failurePersisted:true}})})
 const dialog=await open(page);await dialog.getByRole('button',{name:'Generate Documentation',exact:true}).click()
 await expect(page.getByText('Generation: Failed',{exact:true})).toBeVisible()
 await expect(dialog.getByRole('alert')).toContainText('Gemini service is unavailable')
 await expect(page.getByRole('region',{name:'Saved documentation'})).toContainText('ai_unavailable')
 await expect(page.getByRole('region',{name:'Document preview'})).toHaveCount(0)
 expect(posts).toBe(1)
})
test('documentation network failure reconciles history before another submission and never auto retries',async({page})=>{
 let posts=0,reads=0,release
 await page.route('**/api/project-documents?*',async r=>{reads++;if(posts)await new Promise(resolve=>{release=resolve});await history(r,posts?[doc]:[])})
 await page.route('**/api/project-documents/generate',r=>{posts++;return r.abort('failed')})
 const dialog=await open(page);await dialog.getByRole('button',{name:'Generate Documentation',exact:true}).click()
 await expect.poll(()=>reads).toBeGreaterThan(1)
 try {await expect(dialog.getByRole('button',{name:'Generating...',exact:true})).toBeDisabled()} finally {release()}
 await expect(page.getByRole('region',{name:'Saved documentation'})).toContainText(doc.title)
 await expect(dialog.getByRole('alert')).toContainText('No automatic retry was made')
 expect(posts).toBe(1)
})
test('documentation timeout uses finite 150-second budget and only offers identical request retry',async({page})=>{
 await page.addInitScript(()=>{const timeout=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=ms=>{if(ms===150000)window.documentationTimeout=ms;return timeout(ms===150000?100:ms)}})
 let posts=0,release
 await page.route('**/api/project-documents?*',r=>history(r,posts?[{...doc,generationStatus:'Running'}]:[]))
 await page.route('**/api/project-documents/generate',async r=>{posts++;await new Promise(resolve=>{release=resolve});await r.fulfill({status:201,json:{document:doc}}).catch(()=>{})})
 const dialog=await open(page);await dialog.getByRole('button',{name:'Generate Documentation',exact:true}).click()
 await expect(dialog.getByRole('alert')).toContainText('Request timed out')
 await expect(page.getByRole('region',{name:'Saved documentation'})).toContainText('Running')
 await expect(dialog.getByRole('button',{name:'Retry same request',exact:true})).toBeEnabled()
 await expect(dialog.getByLabel('Document Type',{exact:true})).toBeDisabled()
 expect(await page.evaluate(()=>window.documentationTimeout)).toBe(150000);expect(posts).toBe(1);release()
})
test('documentation saved history and preview stay isolated when projects switch',async({page})=>{
 const second={...doc,id:'33333333-3333-4333-8333-333333333333',projectId:'second-owned',title:'Second project overview'}
 await page.route('**/api/project-documents?*',r=>{const id=new URL(r.request().url()).searchParams.get('projectId');expect(['owned-docs','second-owned']).toContain(id);return history(r,[id==='owned-docs'?doc:second])})
 await page.goto('/documentation');await page.getByRole('button',{name:doc.title,exact:true}).click()
 await expect(page.getByRole('region',{name:'Document preview'})).toContainText(doc.title)
 await page.getByLabel('Documentation project').selectOption('second-owned')
 await expect(page.getByRole('region',{name:'Saved documentation'})).toContainText(second.title)
 await expect(page.getByRole('region',{name:'Document preview'})).toHaveCount(0)
 await expect(page.getByRole('button',{name:doc.title,exact:true})).toHaveCount(0)
})
test('documentation cross-project history and detail responses are rejected',async({page})=>{
 await page.route('**/api/project-documents?*',r=>history(r,[doc]))
 await page.route('**/api/project-documents/'+doc.id,r=>r.fulfill({json:{document:{...doc,projectId:'foreign-project'}}}))
 await page.goto('/documentation');await page.getByRole('button',{name:doc.title,exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Could not load the selected saved document')
 await expect(page.getByRole('region',{name:'Document preview'})).toHaveCount(0)
 await page.getByLabel('Documentation project').selectOption('second-owned')
 await expect(page.getByRole('region',{name:'Saved documentation'}).getByRole('alert')).toBeVisible()
 await expect(page.getByRole('button',{name:doc.title,exact:true})).toHaveCount(0)
})
test('documentation Markdown disables raw HTML, unsafe links and remote images',async({page})=>{
 const hostile={...doc,markdown:'# Safe preview\n<script>window.docInjected=true</script>\n<img src="https://remote.invalid/private.png" onerror="window.docInjected=true">\n![remote](https://remote.invalid/private.png)\n[bad](javascript:alert%281%29)\n[data](data:text/html,bad)\n[good](https://example.com/docs)'}
 let remote=0;await page.route('https://remote.invalid/**',r=>{remote++;return r.abort()})
 await page.route('**/api/project-documents?*',r=>history(r,[hostile]));await page.route('**/api/project-documents/'+doc.id,r=>r.fulfill({json:{document:hostile}}))
 await page.goto('/documentation');await page.getByRole('button',{name:doc.title,exact:true}).click()
 const preview=page.getByTestId('markdown-preview')
 await expect(preview.getByRole('heading',{name:'Safe preview'})).toBeVisible();await expect(preview.locator('script,img,iframe')).toHaveCount(0)
 await expect(preview.locator('a')).toHaveCount(1);await expect(preview.getByRole('link',{name:'good'})).toHaveAttribute('href','https://example.com/docs')
 expect(await page.evaluate(()=>window.docInjected)).toBeUndefined();expect(remote).toBe(0)
})
test('documentation Markdown download uses authenticated attachment endpoint',async({page})=>{
 await page.route('**/api/project-documents?*',r=>history(r,[doc]))
 await page.route('**/api/project-documents/'+doc.id+'/markdown',r=>{expect(r.request().headers().authorization).toBe('Bearer docs-test-token');return r.fulfill({contentType:'text/markdown; charset=utf-8',body:doc.markdown})})
 await page.goto('/documentation');await page.getByRole('button',{name:doc.title,exact:true}).click()
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download Markdown',exact:true}).click()
 const download=await downloadPromise;expect(download.suggestedFilename()).toBe(`document-${doc.id}.md`)
 const stream=await download.createReadStream();let text='';for await(const chunk of stream)text+=chunk.toString();expect(text).toBe(doc.markdown)
})
test('documentation paginated history stays bounded and never uses legacy API',async({page})=>{
 const records=Array.from({length:21},(_,index)=>({...doc,id:`record-${index}`,title:`Saved ${index}`})),legacy=[]
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/documents'))legacy.push(r.url())})
 await page.route('**/api/project-documents?*',r=>{expect(new URL(r.request().url()).searchParams.get('limit')).toBe('20');return history(r,records)})
 await page.goto('/documentation');await expect(page.getByRole('button',{name:'Saved 0',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Next documents',exact:true}).click();await expect(page.getByRole('button',{name:'Saved 20',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Saved 0',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Next documents',exact:true})).toBeDisabled()
 expect(legacy).toEqual([]);await expect(page.getByText('Mock Generated Documentation',{exact:true})).toHaveCount(0)
})
