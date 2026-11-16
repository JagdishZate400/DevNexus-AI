import {test,expect} from '@playwright/test'
import {DOCUMENTATION_TYPES} from '../src/data/documentationTypes.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fixture='/e2e/fixtures/documentation-session.html'
const projects=[{id:'one',name:'Project One'},{id:'two',name:'Project Two'}]
function record(type='project-overview',projectId='one',status='Completed'){
  return {id:'11111111-1111-4111-8111-111111111111',projectId,documentType:type,title:`Saved ${type}`,generationStatus:status,markdown:'# Saved evidence\n\n## Unknowns\n\nRuntime behavior is unavailable.',createdAt:'2026-10-22T10:00:00Z',sourceReferences:[],coverage:{filesSubmitted:0,filesIncluded:0,filesSkipped:0,filesFailed:0,truncated:false}}
}
async function setup(page){
  const real=[]
  await page.route('**/api/**',r=>{real.push(r.request().url());return r.abort()})
  await page.route('**/__documentation_fixture__/**',r=>r.fulfill({status:500,json:{message:'Unexpected fixture request'}}))
  await page.route('**/__documentation_fixture__/projects',r=>r.fulfill({json:{projects}}))
  await page.route('**/__documentation_fixture__/documents?*',r=>r.fulfill({json:{documents:[],total:0,limit:20,offset:Number(new URL(r.request().url()).searchParams.get('offset'))}}))
  return real
}
async function open(page){await page.goto(fixture);await expect(page.getByRole('region',{name:'Saved documentation'})).toContainText('No saved documentation');await page.getByRole('button',{name:'Documentation Setup'}).click();return page.getByRole('dialog')}
for(const type of DOCUMENTATION_TYPES)test(`documentation isolated selection sends canonical ${type.id} with a unique requestId`,async({page})=>{
  const real=await setup(page),payloads=[]
  await page.route('**/__documentation_fixture__/generate',r=>{const payload=r.request().postDataJSON();payloads.push(payload);return r.fulfill({status:201,json:{document:record(payload.documentType,payload.projectId)}})})
  const dialog=await open(page)
  await dialog.getByLabel('Document Type',{exact:true}).selectOption(type.id)
  await dialog.getByRole('button',{name:'Generate Documentation',exact:true}).click()
  await expect(page.getByRole('region',{name:'Document preview'})).toContainText(type.label)
  expect(payloads[0]).toEqual({projectId:'one',documentType:type.id,requestId:expect.stringMatching(uuid)})
  await page.getByRole('button',{name:'Documentation Setup'}).click()
  await expect(page.getByRole('dialog').getByLabel('Document Type',{exact:true})).toHaveValue(type.id)
  await page.getByRole('dialog').getByRole('button',{name:'Generate Documentation',exact:true}).click()
  await expect.poll(()=>payloads.length).toBe(2)
  expect(payloads[1].requestId).not.toBe(payloads[0].requestId);expect(real).toEqual([])
})
test('documentation uncertain retry preserves exact payload, blocks double clicks and locks type',async({page})=>{
  await setup(page);const payloads=[]
  await page.route('**/__documentation_fixture__/generate',r=>{const payload=r.request().postDataJSON();payloads.push(payload);return payloads.length===1?r.abort('failed'):r.fulfill({status:201,json:{document:record(payload.documentType)}})})
  const dialog=await open(page);await dialog.getByLabel('Document Type',{exact:true}).selectOption('readme')
  await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
  await expect(dialog.getByRole('button',{name:'Retry same request'})).toBeEnabled()
  await expect(dialog.getByLabel('Document Type',{exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Refresh saved history'}).evaluate(button=>button.click())
  expect(payloads).toHaveLength(1)
  await dialog.getByRole('button',{name:'Retry same request'}).click()
  await expect(page.getByText('Generation: Completed',{exact:true})).toBeVisible()
  expect(payloads[1]).toEqual(payloads[0])
})
test('documentation known Pending and Running responses use authenticated reads to confirm completion',async({page})=>{
  await setup(page);let posts=0,reads=0
  await page.route('**/__documentation_fixture__/generate',r=>{posts++;return r.fulfill({status:201,json:{document:record('readme','one','Pending')}})})
  await page.route('**/__documentation_fixture__/documents/11111111-1111-4111-8111-111111111111',r=>{reads++;return r.fulfill({json:{document:record('readme','one',reads===1?'Running':'Completed')}})})
  const dialog=await open(page);await dialog.getByLabel('Document Type',{exact:true}).selectOption('readme');await dialog.getByRole('button',{name:'Generate Documentation',exact:true}).click()
  await expect(page.getByText('Generation: Pending',{exact:true})).toBeVisible()
  await expect(dialog.getByRole('button',{name:'Generate Documentation',exact:true})).toBeDisabled()
  await dialog.getByRole('button',{name:'Close documentation modal'}).click()
  await page.getByRole('button',{name:'Check generation status'}).click();await expect(page.getByText('Generation: Running',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Check generation status'}).click();await expect(page.getByText('Generation: Completed',{exact:true})).toBeVisible();expect(posts).toBe(1)
})
test('documentation project switching retains uncertain request identity and discards delayed previews',async({page})=>{
  await setup(page);const payloads=[];let held
  await page.route('**/__documentation_fixture__/generate',r=>{payloads.push(r.request().postDataJSON());return r.abort('failed')})
  const dialog=await open(page);await dialog.getByLabel('Document Type',{exact:true}).selectOption('readme');await dialog.getByRole('button',{name:'Generate Documentation',exact:true}).click()
  await expect(dialog.getByRole('button',{name:'Retry same request'})).toBeEnabled()
  await dialog.getByLabel('Project',{exact:true}).selectOption('two')
  await expect(page.getByRole('dialog').getByRole('button',{name:'Generate Documentation',exact:true})).toBeEnabled()
  await page.getByRole('dialog').getByLabel('Project',{exact:true}).selectOption('one')
  await expect(page.getByRole('dialog').getByRole('button',{name:'Retry same request'})).toBeEnabled()
  await page.getByRole('dialog').getByRole('button',{name:'Retry same request'}).click();await expect.poll(()=>payloads.length).toBe(2);expect(payloads[1]).toEqual(payloads[0])
  await page.getByRole('dialog').getByRole('button',{name:'Close documentation modal'}).click()
  const saved=record()
  await page.route('**/__documentation_fixture__/documents?*',r=>r.fulfill({json:{documents:[saved],total:1,limit:20,offset:0}}))
  await page.route('**/__documentation_fixture__/documents/'+saved.id,async r=>{await new Promise(resolve=>held=resolve);await r.fulfill({json:{document:saved}})})
  await page.getByRole('button',{name:'Refresh saved history'}).click();await page.getByRole('button',{name:saved.title,exact:true}).click()
  await page.getByLabel('Documentation project').selectOption('two');held()
  await expect(page.getByRole('region',{name:'Document preview'})).toHaveCount(0)
})
test('documentation modal traps keyboard focus, restores opener and stays usable on narrow screens',async({page})=>{
  await setup(page);await page.setViewportSize({width:375,height:800});const dialog=await open(page)
  await expect(dialog.getByLabel('Project',{exact:true})).toBeFocused()
  const close=dialog.getByRole('button',{name:'Close documentation modal'}),submit=dialog.getByRole('button',{name:'Generate Documentation',exact:true})
  await close.focus();await page.keyboard.press('Shift+Tab');await expect(submit).toBeFocused()
  await page.keyboard.press('Tab');await expect(close).toBeFocused()
  const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.width).toBeLessThanOrEqual(375)
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Documentation Setup'})).toBeFocused()
})
for(const [code,status,fragment] of [['unsupported_document_type',400,'unavailable'],['document_generation_active',409,'Another generation'],['documentation_evidence_insufficient',400,'more source evidence'],['document_request_expired',410,'expired'],['ai_request_rejected',503,'Gemini rejected'],['document_requests_unavailable',503,'tracking is unavailable']])test(`documentation handles ${code} without automatic resubmission`,async({page})=>{
  await setup(page);let posts=0
  await page.route('**/__documentation_fixture__/generate',r=>{posts++;return r.fulfill({status,json:{code,message:'Provider or storage error',failurePersisted:code==='ai_request_rejected'}})})
  const dialog=await open(page);await dialog.getByRole('button',{name:'Generate Documentation',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText(fragment);await expect(page.getByText('Generation: Failed',{exact:true})).toBeVisible();expect(posts).toBe(1)
})

for(const [id,label] of [['technical-architecture','Architecture Documentation'],['code-documentation','Module Documentation']])test(`documentation preserves historical ${id} and unavailable evidence`,async({page})=>{
  await setup(page)
  const saved={...record(id),coverage:undefined,sourceReferences:undefined}
  await page.route('**/__documentation_fixture__/documents?*',r=>r.fulfill({json:{documents:[saved],total:1,limit:20,offset:0}}))
  await page.route('**/__documentation_fixture__/documents/'+saved.id,r=>r.fulfill({json:{document:saved}}))
  await page.goto(fixture)
  await expect(page.getByRole('region',{name:'Saved documentation'})).toContainText(`Historical type: ${id}`)
  await page.getByRole('button',{name:saved.title,exact:true}).click()
  const preview=page.getByRole('region',{name:'Document preview'})
  await expect(preview).toContainText(label)
  await expect(preview).toContainText(`Historical type: ${id}`)
  await expect(preview).toContainText('Coverage metadata is unavailable.')
  await expect(preview).toContainText('No saved source references.')
})

test('documentation proxy timeout retains the original UUID for explicit retry',async({page})=>{
  await setup(page);const payloads=[]
  await page.route('**/__documentation_fixture__/generate',r=>{
    const payload=r.request().postDataJSON();payloads.push(payload)
    return payloads.length===1?r.fulfill({status:408,json:{message:'Proxy request timeout'}}):r.fulfill({status:201,json:{document:record()}})
  })
  const dialog=await open(page)
  await dialog.getByRole('button',{name:'Generate Documentation',exact:true}).click()
  await expect(page.getByText('Generation: Unconfirmed',{exact:true})).toBeVisible()
  await dialog.getByRole('button',{name:'Retry same request',exact:true}).click()
  await expect(page.getByText('Generation: Completed',{exact:true})).toBeVisible()
  expect(payloads).toHaveLength(2);expect(payloads[1]).toEqual(payloads[0])
})
