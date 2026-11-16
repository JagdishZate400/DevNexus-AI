require('./helpers/offline')
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto')
const {durableFixture}=require('./helpers/document-durable')
const {generateProjectOverview}=require('../src/services/documentGeneration')
const coverage={filesSubmitted:1,filesIncluded:1,filesSkipped:0,filesFailed:0,truncated:false}
test('same durable key replays one record; concurrent same-key preparation does not duplicate',async()=>{
 const f=durableFixture(),input=f.input(crypto.randomUUID())
 const [a,b]=await Promise.all([f.repo.prepareGeneration(input,f.owner),f.repo.prepareGeneration(input,f.owner)])
 assert.equal(a.id,b.id);assert.equal(f.state.documents.length,1);assert.equal(b.generationReplay,true)
 await f.repo.startGeneration(a.id,f.owner)
 await f.repo.completeGeneration(a.id,f.owner,'# Saved',coverage)
 assert.equal((await f.repo.replayGeneration(input,f.owner)).markdown,'# Saved')
 assert.ok(f.state.queries.some(q=>q.includes('pg_advisory_xact_lock')))
})
test('different keys and unkeyed concurrent generation are project-wide conflicts',async()=>{
 const f=durableFixture()
 const results=await Promise.allSettled([f.repo.prepareGeneration(f.input(crypto.randomUUID()),f.owner),f.repo.prepareGeneration(f.input(crypto.randomUUID()),f.owner)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'document_generation_active')
 await assert.rejects(f.repo.prepareGeneration(f.input(),f.owner),{code:'document_generation_active'})
})
test('request key reuse with a different project conflicts, while unauthorized replay reveals nothing',async()=>{
 const f=durableFixture(),input=f.input(crypto.randomUUID())
 await f.repo.prepareGeneration(input,f.owner)
 await assert.rejects(f.repo.replayGeneration({...input,projectId:'second'},f.owner),{code:'document_request_conflict'})
 await assert.rejects(f.repo.replayGeneration(input,f.other),{code:'not_found'})
 f.state.requests[0].document_id=null
 await assert.rejects(f.repo.replayGeneration(input,f.owner),{code:'document_request_conflict'})
})
test('abandoned Running/Pending recover as Failed; late completion is fenced and history retained',async()=>{
 const f=durableFixture(),input=f.input(crypto.randomUUID()),a=await f.repo.prepareGeneration(input,f.owner)
 await f.repo.startGeneration(a.id,f.owner)
 f.state.clock=600001
 await assert.rejects(f.repo.completeGeneration(a.id,f.owner,'# Late',coverage),{code:'document_state_conflict'})
 assert.deepEqual(await f.repo.recoverAbandoned('owned',f.owner),{recovered:1})
 assert.equal(f.state.documents[0].failureCode,'worker_interrupted');assert.equal(f.state.documents[0].markdown,'')
 await assert.rejects(f.repo.completeGeneration(a.id,f.owner,'# Late',coverage),{code:'document_state_conflict'})
 assert.equal((await f.repo.replayGeneration(input,f.owner)).generationStatus,'Failed')
 const b=await f.repo.prepareGeneration(f.input(),f.owner);f.state.clock+=600001
 assert.deepEqual(await f.repo.recoverAbandoned('owned',f.owner),{recovered:1})
 assert.equal((await f.repo.read(b.id,f.owner)).generationStatus,'Failed')
 assert.equal(f.state.documents.length,2)
})
test('fresh active and terminal records are untouched; recovery requires current ownership',async()=>{
 const f=durableFixture(),a=await f.repo.prepareGeneration(f.input(),f.owner)
 assert.deepEqual(await f.repo.recoverAbandoned('owned',f.owner),{recovered:0})
 await assert.rejects(f.repo.recoverAbandoned('owned',f.other),{code:'not_found'})
 await f.repo.startGeneration(a.id,f.owner);await f.repo.completeGeneration(a.id,f.owner,'# Saved',coverage)
 f.state.clock=1000000
 assert.deepEqual(await f.repo.recoverAbandoned('owned',f.owner),{recovered:0})
 assert.equal((await f.repo.read(a.id,f.owner)).markdown,'# Saved')
})
test('keyed requests fail closed without migration; existing unkeyed Overview remains usable',async()=>{
 const f=durableFixture({requestsReady:false})
 await assert.rejects(f.repo.prepareGeneration(f.input(crypto.randomUUID()),f.owner),{code:'document_requests_unavailable'})
 assert.equal(f.state.documents.length,0)
 assert.ok((await f.repo.prepareGeneration(f.input(),f.owner)).id)
})
test('source hash changes prevent completion without replacing document content',async()=>{
 const f=durableFixture(),a=await f.repo.prepareGeneration(f.input(),f.owner)
 await f.repo.startGeneration(a.id,f.owner);f.files[0].hash='b'.repeat(64)
 await assert.rejects(f.repo.completeGeneration(a.id,f.owner,'# Invalid',coverage),{code:'source_changed'})
 assert.equal((await f.repo.read(a.id,f.owner)).markdown,'')
})
test('generation service reconciles durable replays before source discovery or Gemini',async()=>{
 const f=durableFixture(),input=f.input(crypto.randomUUID()),pending=await f.repo.prepareGeneration(input,f.owner)
 const sources={async findProject(){return {id:'owned'}},async discoverReviewFiles(){throw Error('Replay must not rediscover source')}}
 const request={projectId:input.projectId,documentType:input.documentType,requestId:input.requestId}
 const replay=await generateProjectOverview({input:request,ownerId:f.owner,sources,documents:f.repo})
 assert.equal(replay.id,pending.id);assert.equal(replay.generationStatus,'Pending')
 await f.repo.startGeneration(pending.id,f.owner);await f.repo.completeGeneration(pending.id,f.owner,'# Saved',coverage)
 assert.equal((await generateProjectOverview({input:request,ownerId:f.owner,sources,documents:f.repo})).markdown,'# Saved')
 assert.equal(f.state.documents.length,1)
})
