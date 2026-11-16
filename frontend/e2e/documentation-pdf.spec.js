import {test,expect} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {DOCUMENTATION_TYPES} from '../src/data/documentationTypes.js'
const id='11111111-1111-4111-8111-111111111111'
const saved={id,projectId:'pdf-project',documentType:'project-overview',title:'Project Overview',generationStatus:'Completed',createdAt:'2026-10-15T03:00:00.000Z',provider:'gemini',model:'test-model',markdown:'# Project Overview\n\n## Observed functionality\n\nThe **greet** function returns a greeting.\n\n- Supports a name argument.\n- Evidence: [Source: src/app\\.js, lines 1–2]\n\n## Limitations\n\nRuntime behavior requires verification.',sourceReferences:[{fileId:'22222222-2222-4222-8222-222222222222',path:'src/app.js',hash:'a'.repeat(64),lineRanges:[{lineStart:1,lineEnd:2}]}],coverage:{filesSubmitted:1,filesIncluded:1,filesSkipped:0,filesFailed:0,truncated:false}}
async function setup(page,document=saved){
 await page.addInitScript(()=>localStorage.setItem('ai-assistant-auth',JSON.stringify({state:{user:{email:'pdf-owner@example.test',role:'Developer'},token:'pdf-test-token',rememberMe:true},version:0})))
 await page.route('**/api/**',r=>r.fulfill({json:{user:{email:'pdf-owner@example.test',role:'Developer'}}}))
 await page.route('**/api/workspace/projects',r=>r.fulfill({json:{projects:[{id:'pdf-project',name:'DevNexus Test Project'}]}}))
 await page.route('**/api/project-documents?*',r=>r.fulfill({json:{documents:[document],total:1,limit:20,offset:0}}))
 await page.route(`**/api/project-documents/${id}`,r=>r.fulfill({json:{document}}))
 await page.goto('/documentation');await page.getByRole('button',{name:document.title,exact:true}).click()
 await expect(page.getByRole('region',{name:'Document preview'})).toBeVisible()
}
async function exportPdf(page,testInfo){
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF',exact:true}).click()
 const download=await pending;expect(download.suggestedFilename()).toBe(`document-${id}.pdf`)
 const file=testInfo.outputPath('overview.pdf');await download.saveAs(file)
 return new Uint8Array(await readFile(file))
}
async function inspect(bytes){
 const pdf=await getDocument({data:bytes.slice(),useSystemFonts:false}).promise, pages=[]
 try{
  for(let number=1;number<=pdf.numPages;number++){
   const page=await pdf.getPage(number),viewport=page.getViewport({scale:1}),items=(await page.getTextContent()).items.filter(item=>typeof item.str==='string')
   for(const item of items.filter(item=>item.str.trim())){expect(item.transform[4]).toBeGreaterThanOrEqual(55);expect(item.transform[4]+item.width).toBeLessThanOrEqual(viewport.width-54);expect(item.transform[5]).toBeGreaterThanOrEqual(20);expect(item.transform[5]+item.height).toBeLessThanOrEqual(viewport.height-40)}
   pages.push(items.map(item=>item.str).join('').replace(/\u200b/g,'').replace(/\s+/g,' '))
  }
  return {pages,count:pdf.numPages}
 }finally{await pdf.destroy()}
}

for(const type of DOCUMENTATION_TYPES)test(`documentation ${type.id} saved preview and exports retain canonical label`,async({page},testInfo)=>{
 await setup(page,{...saved,documentType:type.id,title:`Saved ${type.label}`})
 await expect(page.getByRole('region',{name:'Document preview'})).toContainText(type.label)
 const result=await inspect(await exportPdf(page,testInfo))
 expect(result.pages.join(' ')).toContain(type.label)
 await page.route(`**/api/project-documents/${id}/markdown`,r=>{
  expect(r.request().headers().authorization).toBe('Bearer pdf-test-token')
  return r.fulfill({contentType:'text/markdown',body:saved.markdown})
 })
 const pending=page.waitForEvent('download')
 await page.getByRole('button',{name:'Download Markdown',exact:true}).click()
 const download=await pending
 await download.saveAs(testInfo.outputPath(`${type.id}.md`))
 expect(await readFile(testInfo.outputPath(`${type.id}.md`),'utf8')).toBe(saved.markdown)
})
test('documentation PDF exports actual saved Markdown, project metadata, citations and coverage',async({page},testInfo)=>{
 await setup(page)
 let reads=0
 await page.route(`**/api/project-documents/${id}`,r=>{reads++;expect(r.request().headers().authorization).toBe('Bearer pdf-test-token');return r.fulfill({json:{document:{...saved,markdown:saved.markdown+'\n\nSaved revision loaded at export.'}}})})
 const bytes=await exportPdf(page,testInfo);expect(Buffer.from(bytes.slice(0,5)).toString()).toBe('%PDF-')
 const result=await inspect(bytes),text=result.pages.join(' ')
 expect(text).toContain('DevNexus Test Project');expect(text).toContain('2026-10-15');expect(text).toContain('Observed functionality');expect(text).toContain('Saved revision loaded at export.');expect(text).toContain('src/app.js');expect(text).toContain('lines 1-2');expect(text).toContain('Submitted: 1');expect(text).toContain('Included: 1');expect(text).toContain('SHA-256:');expect(text).toContain('Page 1 of');expect(text).not.toContain('src/app\\.js');expect(reads).toBe(1)
})
test('documentation PDF paginates long paragraphs, bullets and long tokens without clipping',async({page},testInfo)=>{
 test.setTimeout(90000)
 const paragraphs=Array.from({length:75},(_,index)=>`## Section ${index+1}\n\nThe saved source provides function ${index+1}. This paragraph checks readable wrapping across the page while keeping source evidence and limitations visible. Additional analysis is not performed during export.\n\n- First supported observation.\n- Second observation with [Source: src/app\\.js, lines 1–2].`)
 const long={...saved,markdown:'# Project Overview\n\n'+paragraphs.join('\n\n')+'\n\nLong identifier: '+ 'longtoken'.repeat(80)}
 await setup(page,long)
 const bytes=await exportPdf(page,testInfo),result=await inspect(bytes)
 expect(result.count).toBeGreaterThan(3)
 for(const [index,text] of result.pages.entries())expect(text).toContain(`Page ${index+1} of ${result.count}`)
 expect(result.pages.at(-1)).toContain('Saved coverage')
 // Render the real PDF with PDF.js. No Poppler is installed on this host.
 const images=await page.evaluate(async data=>{
  const engine=await import('/node_modules/pdfjs-dist/build/pdf.mjs');engine.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs'
  const pdf=await engine.getDocument({data:new Uint8Array(data),useSystemFonts:false}).promise
  const sheet=document.createElement('canvas');sheet.width=900;sheet.height=Math.ceil(pdf.numPages/3)*425
  const context=sheet.getContext('2d');context.fillStyle='white';context.fillRect(0,0,sheet.width,sheet.height)
  const output=[]
  for(let i=1;i<=pdf.numPages;i++){
   const page=await pdf.getPage(i),viewport=page.getViewport({scale:1.3}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height
   await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise
   context.drawImage(canvas,((i-1)%3)*300,Math.floor((i-1)/3)*425,300,425)
   if([1,Math.ceil(pdf.numPages/2),pdf.numPages].includes(i))output.push({name:`page-${i}.png`,data:canvas.toDataURL('image/png').split(',')[1]})
  }
  output.push({name:'all-pages.png',data:sheet.toDataURL('image/png').split(',')[1]});await pdf.destroy();return output
 },Array.from(bytes))
 for(const image of images)await writeFile(testInfo.outputPath(image.name),Buffer.from(image.data,'base64'))
})
test('documentation PDF preserves accented text, Greek, quotes, punctuation and escaped citations',async({page},testInfo)=>{
 await setup(page,{...saved,markdown:'# Résumé\n\nCafé naïve façade; Ελληνικά; “quoted” &amp; &lt;literal&gt;.\n\n- Evidence: [Source: src/app\\.js, lines 1–2]\n\n1. First ordered item\n2. Second ordered item'})
 const result=await inspect(await exportPdf(page,testInfo)),text=result.pages.join(' ')
 for(const expected of ['Résumé','Café','naïve','façade','Ελληνικά','“quoted”','<literal>','First ordered item','src/app.js, lines 1-2'])expect(text).toContain(expected)
})
test('documentation PDF never executes HTML or loads remote resources',async({page},testInfo)=>{
 let remote=0;await page.route('https://remote.invalid/**',r=>{remote++;return r.abort()})
 await setup(page,{...saved,markdown:'# Security\n\n<script>window.pdfInjected=true</script>\n\n![external](https://remote.invalid/private.png)\n\n[unsafe](javascript:alert%281%29)'})
 const text=(await inspect(await exportPdf(page,testInfo))).pages.join(' ')
 expect(text).toContain('[Image omitted]');expect(remote).toBe(0);expect(await page.evaluate(()=>window.pdfInjected)).toBeUndefined()
})
test('documentation empty saved Markdown disables PDF export',async({page})=>{
 await setup(page,{...saved,markdown:''});await expect(page.getByRole('button',{name:'Download PDF',exact:true})).toBeDisabled()
})
test('documentation PDF authorization failure reports error and produces no download',async({page})=>{
 await setup(page);let downloads=0;page.on('download',()=>downloads++)
 await page.route(`**/api/project-documents/${id}`,r=>r.fulfill({status:404,json:{message:'Owned document not found.'}}))
 await page.getByRole('button',{name:'Download PDF',exact:true}).click()
 await expect(page.getByRole('region',{name:'Document preview'}).getByRole('alert')).toHaveText('Owned document not found.')
 await expect(page.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled();expect(downloads).toBe(0)
})
test('documentation PDF loading and duplicate-click protection preserve Markdown download',async({page},testInfo)=>{
 await setup(page);let release,reads=0
 await page.route(`**/api/project-documents/${id}`,async r=>{reads++;await new Promise(resolve=>{release=resolve});await r.fulfill({json:{document:saved}})})
 const pending=page.waitForEvent('download')
 await page.getByRole('button',{name:'Download PDF',exact:true}).evaluate(button=>{button.click();button.click()})
 try{await expect(page.getByRole('button',{name:'Exporting PDF...',exact:true})).toBeDisabled();await expect.poll(()=>reads).toBe(1)}finally{release()}
 const downloaded=await pending;await downloaded.saveAs(testInfo.outputPath('duplicate-protection.pdf'))
 await page.route(`**/api/project-documents/${id}/markdown`,r=>r.fulfill({contentType:'text/markdown',body:saved.markdown}))
 const markdown=page.waitForEvent('download');await page.getByRole('button',{name:'Download Markdown',exact:true}).click();expect((await markdown).suggestedFilename()).toBe(`document-${id}.md`)
})
