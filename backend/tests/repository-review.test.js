require('./helpers/offline')
const { test,before }=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const request=require('supertest')
const config=require('../src/config')
Object.assign(config,{aiProvider:'gemini',geminiApiKey:'test-key',geminiModel:'test-model',geminiTimeoutMs:1000})
const {createApp}=require('../src/app')
const {createTestRepository}=require('./helpers/users')
const {signToken}=require('../src/middleware/auth')
const owner={id:crypto.randomUUID(),email:'review-owner@example.com',role:'Developer'}
const other={id:crypto.randomUUID(),email:'review-other@example.com',role:'Project Manager'}
const source={id:crypto.randomUUID(),path:'src/app.js',language:'JavaScript',content:'eval(input)\r\nconst x = 1;'}
source.sha256=crypto.createHash('sha256').update(source.content).digest('hex')
const records=new Map()
const repo={
  async start(input,uid){const id=crypto.randomUUID();records.set(id,{id,...input,owner:uid,project:'Test',provider:'gemini',status:'In Progress',findings:[],repository:true});return id},
  async read(id,uid){const r=records.get(id);return r?.owner===uid ? {...r,findingsCount:r.findings.length}:null},
  async list(uid){return [...records.values()].filter((r)=>r.owner===uid).map((r)=>({...r,findingsCount:r.findings.length}))},
  async complete(id,uid,findings){const r=records.get(id);r.status='Completed';r.findings=findings;return this.read(id,uid)},
  async fail(id,uid,code){const r=records.get(id);r.status='Failed';r.errorCode=code},
  async triage(id,fid,uid,status){const r=records.get(id),f=r?.findings.find((f)=>f.id===fid);if(!r || r.owner!==uid || !f)throw Object.assign(new Error('Finding not found'),{code:'not_found',status:404});f.status=status;return this.read(id,uid)},
  async getStats(uid){
    const userReviews=[...records.values()].filter((r)=>r.owner===uid)
    const openFindings=userReviews.flatMap((r)=>r.findings).filter((f)=>f.status==='Open').length
    const resolvedFindings=userReviews.flatMap((r)=>r.findings).filter((f)=>f.status && f.status!=='Open').length
    return {
      totalReviews:userReviews.length,
      filesReviewed:userReviews.filter((r)=>r.status==='Completed').length,
      openFindings,
      resolvedFindings,
      totalFindings:openFindings+resolvedFindings,
      projectsCount:new Set(userReviews.map((r)=>r.project)).size,
      recentThisMonth:userReviews.length,
    }
  },
}
let app,token,otherToken,users
const sources={async findProject(id,uid){return id==='owned-review' && uid===owner.id ? {id,name:'Test'}:null},async readFile(id,fid,uid){return uid===owner.id && fid===source.id ? {...source}:null}}
before(async()=>{users=createTestRepository();await users.createUser(owner);await users.createUser(other);token=signToken(owner);otherToken=signToken(other);app=createApp({userRepository:users,sourceRepository:sources,reviewRepository:repo})})
const payload=()=>({projectId:'owned-review',fileId:source.id,options:{focus:'Security'}})
let testIP=1
function post(body=payload(),auth=token){return request(app).post('/api/repository-reviews').set('X-Forwarded-For',`192.0.2.${testIP++}`).set('Authorization',`Bearer ${auth}`).send(body)}
async function mock(fetch,run){const old=global.fetch;global.fetch=fetch;try{await run()}finally{global.fetch=old}}
function model(findings){return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({findings})}]}}]}))}
const finding={findingType:'Security',severity:'High',line:1,category:'Security',problem:'Dynamic execution.',explanation:'Input may execute code.',improvement:'Use a parser.',suggestedCode:''}

test('owned uploaded-file review uses stored source, path/hash and exact line evidence; history and triage survive app recreation',async()=>{
  let review
  await mock(async(_,opts)=>{const body=JSON.parse(opts.body);const input=JSON.parse(body.contents[0].parts[0].text);assert.equal(input.source,source.content);assert.equal(input.file,source.path);assert.equal(input.focus,'Security');assert.match(body.systemInstruction.parts[0].text,/Dedicated Security profile/);return model([finding])},async()=>{
    const res=await post();assert.equal(res.status,201);review=res.body.review;assert.equal(review.findings[0].findingType,'Security');assert.equal(review.sourceHash,source.sha256);assert.equal(review.coverage.truncated,false);assert.equal(review.coverage.lines,2);assert.equal(review.findings[0].line,'1');assert.equal(review.findings[0].code,'eval(input)');assert.equal(review.findings[0].file,source.path)
  })
  const restarted=createApp({userRepository:users,sourceRepository:sources,reviewRepository:repo})
  const res=await request(restarted).patch(`/api/repository-reviews/${review.id}/findings/${review.findings[0].id}`).set('Authorization',`Bearer ${token}`).send({status:'Fixed'})
  assert.equal(res.status,200)
  assert.equal((await request(restarted).get(`/api/repository-reviews/${review.id}`).set('Authorization',`Bearer ${token}`)).body.review.findings[0].status,'Fixed')
  assert.ok((await request(restarted).get('/api/repository-reviews').set('Authorization',`Bearer ${token}`)).body.reviews.some((r)=>r.id===review.id))
  assert.equal((await request(restarted).get(`/api/repository-reviews/${review.id}`).set('Authorization',`Bearer ${otherToken}`)).status,404)
  assert.equal((await request(restarted).patch(`/api/repository-reviews/${review.id}/findings/${review.findings[0].id}`).set('Authorization',`Bearer ${otherToken}`).send({status:'Open'})).status,404)
})
test('authentication, manager cross-owner denial, invalid IDs and browser source/path rejection',async()=>{
  assert.equal((await request(app).post('/api/repository-reviews').send(payload())).status,401)
  assert.equal((await post(payload(),otherToken)).status,404)
  assert.equal((await post({...payload(),fileId:'invalid'})).status,400)
  assert.equal((await post({...payload(),fileId:crypto.randomUUID()})).status,404)
  assert.equal((await post({...payload(),code:'malicious replacement',file:'other.js'})).status,400)
})
test('source hash, unsupported files and size validation happen before model or review creation',async()=>{
  const original={...source},count=records.size
  try{
    source.sha256='0'.repeat(64);assert.equal((await post()).status,409)
    Object.assign(source,original);source.path='.env';assert.equal((await post()).status,400)
    Object.assign(source,original);source.content='a'.repeat(50001);assert.equal((await post()).status,413)
  }finally{Object.assign(source,original)}
  assert.equal(records.size,count)
})
test('clean source permits zero findings and malformed line numbers fail without completed findings',async()=>{
  await mock(async()=>model([]),async()=>{const res=await post();assert.equal(res.status,201);assert.deepEqual(res.body.review.findings,[])})
  await mock(async()=>model([{...finding,line:99}]),async()=>{const res=await post();assert.equal(res.status,502);assert.equal(res.body.code,'ai_malformed_response');assert.equal([...records.values()].at(-1).status,'Failed')})
})
test('Gemini errors and timeout persist sanitized Failed status, with no mock findings',async()=>{
  // Fresh router limiter budget for this independent fixture.
  await mock(async()=>new Response('private upstream error',{status:503}),async()=>{const res=await post();assert.equal(res.status,503);assert.equal([...records.values()].at(-1).errorCode,'ai_unavailable');assert.ok(!JSON.stringify(res.body).includes('private'))})
  await mock((_,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('private timeout')))),async()=>{
    // Reset the upload fixture IP to avoid unrelated rate-limit counts from validation tests.
    const res=await request(app).post('/api/repository-reviews').set('X-Forwarded-For','192.0.2.23').set('Authorization',`Bearer ${token}`).send(payload())
    assert.equal(res.status,504);assert.equal(res.body.code,'ai_timeout');assert.equal([...records.values()].at(-1).status,'Failed')
  })
})

test('Bugs profile uses owned stored source and saves its classification',async()=>{
 await mock(async(_,opts)=>{const body=JSON.parse(opts.body);assert.match(body.systemInstruction.parts[0].text,/Dedicated Bugs profile/);assert.equal(JSON.parse(body.contents[0].parts[0].text).source,source.content);return model([{...finding,findingType:'Bug'}])},async()=>{
  const result=await post({...payload(),options:{focus:'Bugs'}});assert.equal(result.status,201);assert.equal(result.body.review.findings[0].findingType,'Bug')
  const saved=await request(app).get(`/api/repository-reviews/${result.body.review.id}`).set('Authorization',`Bearer ${token}`);assert.equal(saved.body.review.findings[0].findingType,'Bug')
 })
})
test('single-file endpoint accepts combined focus and persists both finding classifications',async()=>{
 await mock(async(_,opts)=>{const body=JSON.parse(opts.body);assert.match(body.systemInstruction.parts[0].text,/Dedicated BugsAndSecurity profile/);return model([{...finding,findingType:'Bug'},{...finding,findingType:'Security'}])},async()=>{
  const result=await post({...payload(),options:{focus:'BugsAndSecurity'}})
  assert.equal(result.status,201);assert.equal(result.body.review.options.focus,'BugsAndSecurity');assert.deepEqual(result.body.review.findings.map(f=>f.findingType),['Bug','Security'])
  const saved=await request(app).get(`/api/repository-reviews/${result.body.review.id}`).set('Authorization',`Bearer ${token}`)
  assert.deepEqual(saved.body.review.findings.map(f=>f.findingType),['Bug','Security'])
 })
})
test('single-file custom focus is normalized, persisted and supplied as trusted priority instructions',async()=>{
 const options={focus:'BugsAndSecurity',analysisFocus:{bugs:['logic_errors','error_handling'],security:['xss']}}
 await mock(async(_,opts)=>{const prompt=JSON.parse(opts.body).systemInstruction.parts[0].text;assert.match(prompt,/server-allowlisted checks: Error Handling; Logic Errors; XSS/);return model([])},async()=>{
  const res=await post({...payload(),options});assert.equal(res.status,201)
  assert.deepEqual(res.body.review.options,{focus:'BugsAndSecurity',analysisFocus:{bugs:['error_handling','logic_errors'],security:['xss']}})
  const saved=await request(app).get(`/api/repository-reviews/${res.body.review.id}`).set('Authorization',`Bearer ${token}`)
  assert.deepEqual(saved.body.review.options,res.body.review.options)
 })
})
test('single-file custom focus rejects invalid selections before Gemini or review creation',async()=>{
 const count=records.size
 await mock(async()=>assert.fail('No Gemini call for invalid selections'),async()=>{
  for(const analysisFocus of [{bugs:['unknown']},{bugs:['logic_errors','logic_errors']},{security:['xss']},{bugs:'logic_errors'},null]){
   const res=await post({...payload(),options:{focus:'Bugs',analysisFocus}});assert.equal(res.status,400)
  }
 })
 assert.equal(records.size,count)
})

test('GET /api/repository-reviews/stats returns user-scoped real metrics and non-evaluated quality status', async () => {
  const unauth = await request(app).get('/api/repository-reviews/stats')
  assert.equal(unauth.status, 401)

  const res = await request(app).get('/api/repository-reviews/stats').set('Authorization', `Bearer ${token}`)
  assert.equal(res.status, 200)
  assert.equal(typeof res.body.stats.totalReviews, 'number')
  assert.equal(typeof res.body.stats.filesReviewed, 'number')
  assert.equal(typeof res.body.stats.openFindings, 'number')
  assert.equal(typeof res.body.stats.resolvedFindings, 'number')
  assert.equal(res.body.quality.status, 'not_evaluated')
  assert.equal(res.body.quality.metrics.length, 4)
  assert.equal(res.body.quality.metrics[0].value, 'Not evaluated')

  // Owner B has separate isolation
  const resB = await request(app).get('/api/repository-reviews/stats').set('Authorization', `Bearer ${otherToken}`)
  assert.equal(resB.status, 200)
  assert.equal(resB.body.stats.totalReviews, 0)
  assert.equal(resB.body.stats.filesReviewed, 0)
})
