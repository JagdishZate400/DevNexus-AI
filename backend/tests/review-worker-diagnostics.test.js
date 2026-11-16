require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const config=require('../src/config')
Object.assign(config,{aiProvider:'gemini',geminiApiKey:'SECRET_TEST_KEY',geminiModel:'test-model',geminiTimeoutMs:1000})
const {analyzeSource}=require('../src/services/gemini')
const {createReviewBatchWorker}=require('../src/services/reviewBatchWorker')
const content='const privateSourceMarker = 1;'
const input={code:content,language:'javascript',file:'private-source.js',focus:'Bugs'}
function response(text){return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]}))}
async function mocked(fetch,run){const old=global.fetch;global.fetch=fetch;try{await run()}finally{global.fetch=old}}
function safe(events){const log=JSON.stringify(events);for(const secret of ['SECRET_TEST_KEY','privateSourceMarker','private-source.js','RAW_UPSTREAM_SECRET','RAW_NETWORK_SECRET','authorization','systemInstruction'])assert.ok(!log.includes(secret),secret)}
for(const status of [500,502,503,504,429])test(`HTTP ${status} preserves public category and reports status`,async()=>{
 const events=[]
 await mocked(async()=>new Response('RAW_UPSTREAM_SECRET',{status}),async()=>assert.rejects(analyzeSource({...input,diagnostic:e=>events.push(e)}),e=>e.code===(status===429 ? 'ai_quota' : 'ai_unavailable')))
 assert.equal(events[0].httpStatus,status);assert.equal(events[0].diagnosticCategory,`http_${status}`);assert.ok(events[0].requestBytes>0);assert.ok(events[0].elapsedMs>=0);safe(events)
})
test('fetch failure, stream interruption and programming error are diagnostically distinct',async()=>{
 for(const [fetch,reason,status] of [
  [async()=>{throw new TypeError('RAW_NETWORK_SECRET')},'network_fetch_failure',null],
  [async()=>new Response(new ReadableStream({pull(controller){controller.error(new Error('RAW_NETWORK_SECRET'))}})),'response_stream_interrupted',200],
  [async()=>{throw new ReferenceError('RAW_NETWORK_SECRET')},'programming_error',null],
 ]){
  const events=[];await mocked(fetch,async()=>assert.rejects(analyzeSource({...input,diagnostic:e=>events.push(e)}),e=>e.code==='ai_unavailable'))
  assert.equal(events[0].diagnosticCategory,reason);assert.equal(events[0].httpStatus,status);safe(events)
 }
})
test('timeout remains ai_timeout and includes sanitized attempt metadata',async()=>{
 const events=[]
 await mocked(async(_,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('RAW_NETWORK_SECRET')))}),async()=>assert.rejects(analyzeSource({...input,diagnostic:e=>events.push(e)}),e=>e.code==='ai_timeout'))
 assert.equal(events[0].diagnosticCategory,'gemini_timeout');safe(events)
})
test('malformed envelope, malformed review JSON and invalid finding classify at the right phase',async()=>{
 const invalid={findingType:'Security',severity:'High',line:1,category:'Logic',problem:'p',explanation:'e',improvement:'i',suggestedCode:''}
 for(const [fetch,phase,reason] of [[async()=>new Response('RAW_UPSTREAM_SECRET'),'response_validation','model_output_malformed'],[async()=>response('not JSON'),'findings_validation','model_output_malformed'],[async()=>response(JSON.stringify({findings:[invalid]})),'findings_validation','findings_validation_failure']]){
  const events=[];await mocked(fetch,async()=>assert.rejects(analyzeSource({...input,diagnostic:e=>events.push(e)}),e=>e.code==='ai_malformed_response'))
  assert.equal(events.at(-1).phase,phase);assert.equal(events.at(-1).diagnosticCategory,reason);safe(events)
 }
})
function fixture(events,diagnostic=e=>events.push(e)){
 const hash=crypto.createHash('sha256').update(content).digest('hex')
 const job={batch_id:'batch-id',file_id:'file-id',projectId:'project-id',ownerId:'owner-id',attempt:1,source_sha256:hash,path:'private-source.js',byte_count:Buffer.byteLength(content),line_count:1,model:'test-model',options:{focus:'Bugs'}}
 const outcomes=[]
 const batches={claim:async()=>job,attachReview:async()=> 'review-id',finish:async(j,outcome)=>{outcomes.push(outcome);return true}}
 const sources={findProject:async()=>({id:job.projectId}),readFile:async()=>({path:job.path,language:'JavaScript',content,sha256:hash})}
 return {job,outcomes,batches,worker:createReviewBatchWorker({batches,sources,configuration:config,diagnostic})}
}
test('zero-finding success reports generation and persistence without source; callbacks cannot break it',async()=>{
 const events=[],f=fixture(events)
 await mocked(async()=>response('{"findings":[]}'),async()=>assert.equal(await f.worker.runOnce(),true))
 assert.deepEqual(events.map(e=>e.event),['attempt_started','generation_completed','persistence_completed'])
 for(const event of events){assert.equal(event.batchId,'batch-id');assert.equal(event.fileId,'file-id');assert.equal(event.attempt,1);assert.equal(event.apiVersion,'v1beta');assert.equal(event.model,'test-model');assert.ok(event.elapsedMs>=0)}
 assert.deepEqual(f.outcomes[0].findings,[]);safe(events)
 for(const callback of [()=>{throw new Error('RAW_NETWORK_SECRET')},async()=>{throw new Error('RAW_NETWORK_SECRET')}]){
  const broken=fixture([],callback)
  await mocked(async()=>response('{"findings":[]}'),async()=>assert.equal(await broken.worker.runOnce(),true))
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(broken.outcomes[0].findings,[])
 }
})
test('503 retry followed by zero-finding success remains bounded and observable',async()=>{
 const events=[],f=fixture(events)
 await mocked(async()=>new Response('RAW_UPSTREAM_SECRET',{status:503}),async()=>await f.worker.runOnce())
 assert.equal(f.outcomes[0].code,'ai_unavailable');assert.equal(f.outcomes[0].retry,true)
 f.job.attempt=2
 await mocked(async()=>response('{"findings":[]}'),async()=>await f.worker.runOnce())
 assert.deepEqual(f.outcomes[1].findings,[]);assert.ok(events.some(e=>e.event==='generation_failed'&&e.httpStatus===503));assert.ok(events.some(e=>e.event==='persistence_completed'&&e.attempt===2));safe(events)
})
test('worker validation failure, persistence failure and stale completion have separate events',async()=>{
 const events=[],f=fixture(events)
 await mocked(async()=>response('{"findings":[{}]}'),async()=>await f.worker.runOnce())
 assert.ok(events.some(e=>e.event==='findings_validation_failed'));assert.equal(f.outcomes[0].retry,false)
 events.length=0;f.batches.finish=async()=>false
 await mocked(async()=>response('{"findings":[]}'),async()=>assert.equal(await f.worker.runOnce(),false))
 assert.ok(events.some(e=>e.event==='completion_rejected'));assert.ok(!events.some(e=>e.event==='persistence_completed'))
 events.length=0;f.batches.finish=async()=>{throw new Error('RAW_UPSTREAM_SECRET')}
 await mocked(async()=>response('{"findings":[]}'),async()=>assert.rejects(f.worker.runOnce()))
 assert.ok(events.some(e=>e.event==='persistence_failed'));safe(events)
})
test('throwing diagnostics cannot change HTTP failures or rejected completion',async()=>{
 const f=fixture([],()=>{throw new Error('RAW_NETWORK_SECRET')})
 await mocked(async()=>new Response('RAW_UPSTREAM_SECRET',{status:503}),async()=>await f.worker.runOnce())
 assert.equal(f.outcomes[0].code,'ai_unavailable')
 f.batches.finish=async()=>false
 await mocked(async()=>response('{"findings":[]}'),async()=>assert.equal(await f.worker.runOnce(),false))
})
test('direct adapter callbacks throwing synchronously or asynchronously cannot alter outcomes',async()=>{
 for(const diagnostic of [()=>{throw new Error('RAW_NETWORK_SECRET')},async()=>{throw new Error('RAW_NETWORK_SECRET')}]){
  await mocked(async()=>response('{"findings":[]}'),async()=>assert.deepEqual(await analyzeSource({...input,diagnostic}),[]))
  await mocked(async()=>new Response('RAW_UPSTREAM_SECRET',{status:503}),async()=>assert.rejects(analyzeSource({...input,diagnostic}),e=>e.code==='ai_unavailable'))
  await new Promise(resolve=>setImmediate(resolve))
 }
})
test('unknown exception codes and optional callback fields are not copied into diagnostics',async()=>{
 const events=[]
 await mocked(async()=>{throw Object.assign(new Error('RAW_NETWORK_SECRET'),{code:'ai_RAW_UPSTREAM_SECRET'})},async()=>assert.rejects(analyzeSource({...input,diagnostic:e=>events.push(e)})))
 safe(events);assert.equal(events[0].category,'ai_unavailable');assert.equal(events[0].diagnosticCategory,'unexpected_adapter_error')
})
