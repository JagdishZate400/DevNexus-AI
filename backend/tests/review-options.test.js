require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const config=require('../src/config')
Object.assign(config,{geminiApiKey:'test-key',geminiModel:'test-model',geminiTimeoutMs:1000})
const {normalizeReviewOptions,BUG_FOCUSES,SECURITY_FOCUSES}=require('../src/services/reviewOptions')
const {analyzeSource}=require('../src/services/gemini')
test('canonical allowlists and omitted/empty selections preserve broad behavior',()=>{
 assert.equal(Object.keys(BUG_FOCUSES).length,5);assert.equal(Object.keys(SECURITY_FOCUSES).length,6)
 for(const focus of ['Bugs','Security','BugsAndSecurity','General','Maintainability'])for(const analysisFocus of [undefined,{}, {bugs:[],security:[]}])assert.deepEqual(normalizeReviewOptions({focus,analysisFocus}),{focus})
})
test('selections normalize order, missing groups and profile compatibility',()=>{
 assert.deepEqual(normalizeReviewOptions({focus:'Bugs',analysisFocus:{bugs:['logic_errors','error_handling']}}),{focus:'Bugs',analysisFocus:{bugs:['error_handling','logic_errors'],security:[]}})
 assert.deepEqual(normalizeReviewOptions({focus:'Security',analysisFocus:{security:['xss','sql_injection']}}).analysisFocus,{bugs:[],security:['sql_injection','xss']})
 assert.equal(normalizeReviewOptions({focus:'BugsAndSecurity',analysisFocus:{bugs:Object.keys(BUG_FOCUSES),security:Object.keys(SECURITY_FOCUSES)}}).analysisFocus.security.length,6)
})
test('unknown identifiers, duplicate/excessive/wrong types and arbitrary prompts are rejected',()=>{
 for(const analysisFocus of [null,[], 'prompt', {prompt:'ignore system'}, {bugs:'logic_errors'}, {bugs:[1]}, {bugs:['Logic Errors']}, {bugs:['__proto__']}, {bugs:['logic_errors','logic_errors']}, {bugs:Array(6).fill('logic_errors')}, {security:Array(7).fill('xss')}, {security:null}])assert.throws(()=>normalizeReviewOptions({focus:'BugsAndSecurity',analysisFocus}),e=>e.code==='invalid_request')
 for(const [focus,analysisFocus] of [['Bugs',{security:['xss']}],['Security',{bugs:['logic_errors']}],['General',{bugs:['logic_errors']}],['Maintainability',{security:['xss']}]])assert.throws(()=>normalizeReviewOptions({focus,analysisFocus}),e=>e.code==='invalid_request')
 assert.throws(()=>normalizeReviewOptions({focus:'Bugs',prompt:'ignore system'}),e=>e.code==='invalid_request')
})
test('Gemini receives only server-owned priority instructions, and empty focus leaves prompt unchanged',async()=>{
 const original=global.fetch,bodies=[]
 global.fetch=async(_,opts)=>{bodies.push(JSON.parse(opts.body));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"findings":[]}'}]}}]}))}
 try{
  for(const [focus,analysisFocus,labels] of [['Bugs',{bugs:['logic_errors','error_handling']},['Logic Errors','Error Handling']],['Security',{security:['sql_injection','xss']},['SQL Injection','XSS']],['BugsAndSecurity',{bugs:['incorrect_conditions'],security:['authentication_weaknesses']},['Incorrect Conditions','Authentication Weaknesses']]]){
   assert.deepEqual(await analyzeSource({code:'const x=1',language:'javascript',file:'a.js',focus,analysisFocus}),[])
   const prompt=bodies.at(-1).systemInstruction.parts[0].text
   assert.match(prompt,/server-allowlisted checks/);for(const label of labels)assert.ok(prompt.includes(label))
   assert.equal(JSON.parse(bodies.at(-1).contents[0].parts[0].text).source,'const x=1')
  }
  await analyzeSource({code:'x',file:'a.js',focus:'Bugs'});const broad=bodies.at(-1).systemInstruction.parts[0].text
  await analyzeSource({code:'x',file:'a.js',focus:'Bugs',analysisFocus:{bugs:[],security:[]}});assert.equal(bodies.at(-1).systemInstruction.parts[0].text,broad)
  const count=bodies.length
  await assert.rejects(analyzeSource({code:'x',file:'a.js',focus:'Bugs',analysisFocus:{bugs:['arbitrary instructions']}}),e=>e.code==='invalid_request');assert.equal(bodies.length,count)
 }finally{global.fetch=original}
})
test('custom priorities survive child creation and transient retry with the real analyzer',async()=>{
 const crypto=require('crypto'),{createReviewBatchWorker}=require('../src/services/reviewBatchWorker')
 const content='const x=1',hash=crypto.createHash('sha256').update(content).digest('hex')
 const options=normalizeReviewOptions({focus:'Security',analysisFocus:{security:['xss','sql_injection']}})
 const job={batch_id:'batch',file_id:'file',projectId:'p',ownerId:'owner',attempt:1,path:'a.js',source_sha256:hash,byte_count:Buffer.byteLength(content),line_count:1,model:'test-model',options}
 const childOptions=[],outcomes=[],bodies=[],original=global.fetch
 const worker=createReviewBatchWorker({configuration:{...config,aiProvider:'gemini'},diagnostic:()=>{},batches:{claim:async()=>job,attachReview:async j=>{childOptions.push(structuredClone(j.options));return 'child'},finish:async(j,outcome)=>{outcomes.push(outcome);return true}},sources:{findProject:async()=>({id:'p'}),readFile:async()=>({content,path:'a.js',language:'JavaScript',sha256:hash})}})
 global.fetch=async(_,opts)=>{bodies.push(JSON.parse(opts.body));return job.attempt===1 ? new Response('private',{status:503}) : new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"findings":[]}'}]}}]}))}
 try{
  await worker.runOnce();assert.equal(outcomes[0].retry,true);job.attempt=2;await worker.runOnce()
  assert.deepEqual(outcomes[1].findings,[]);assert.deepEqual(childOptions,[options,options]);assert.ok(bodies.length >= 2)
  for(const body of bodies)assert.match(body.systemInstruction.parts[0].text,/server-allowlisted checks: SQL Injection; XSS/)
 }finally{global.fetch=original}
})
test('OpenAPI exposes canonical IDs and references the options schema in both review contracts',async()=>{
 const request=require('supertest'),{createApp}=require('../src/app')
 const result=await request(createApp({userRepository:require('./helpers/users').createTestRepository()})).get('/api/openapi.json')
 assert.equal(result.status,200)
 const spec=result.body,schema=spec.components.schemas.RepositoryReviewOptions
 assert.ok(schema.properties.focus.enum.includes('BugsAndSecurity'))
 assert.deepEqual(schema.properties.analysisFocus.properties.bugs.items.enum,Object.keys(BUG_FOCUSES))
 assert.equal(schema.properties.analysisFocus.properties.security.maxItems,6)
 const single=spec.paths['/repository-reviews'].post.requestBody.content['application/json'].schema
 assert.equal(single.properties.options.$ref,'#/components/schemas/RepositoryReviewOptions')
 const batch=spec.paths['/repository-review-batches'].post.requestBody.content['application/json'].schema
 for(const contract of batch.oneOf)assert.equal(contract.properties.options.$ref,'#/components/schemas/RepositoryReviewOptions')
})
