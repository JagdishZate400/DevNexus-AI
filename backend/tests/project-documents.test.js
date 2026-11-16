require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const request = require('supertest')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const { createDocumentRepository } = require('../src/db/documentRepository')
const v = require('../src/services/documentValidation')
function database() {
  const owner = crypto.randomUUID(), other = crypto.randomUUID(), fileId = crypto.randomUUID()
  const file = { fileId,path:'src/app.js',hash:'a'.repeat(64),byteSize:20 }
  let documents = [], snapshot
  const calls = []
  let failUpdate = false, failCommit = false
  const pool = {
    async connect() { return { query:pool.query,release() {} } },
    async query(sql,args=[]) {
      calls.push({sql,args})
      const rows = result => ({ rows:result })
      if (sql === 'BEGIN') { snapshot = structuredClone(documents); return rows([]) }
      if (sql === 'ROLLBACK') { documents = snapshot; return rows([]) }
      if (sql === 'COMMIT' && failCommit) throw new Error('Commit failure')
      if (sql === 'COMMIT' || sql.startsWith('SET LOCAL')) return rows([])
      if (sql.startsWith('SELECT id FROM source_projects')) return rows(args[0]==='owned' && args[1]===owner ? [{id:'owned'}] : [])
      if (sql.includes('FROM source_files')) return rows(args[0]==='owned' && args[1].includes(fileId) ? [{...file}] : [])
      if (sql.startsWith('INSERT INTO project_documents')) {
        const [id,projectId,creatorId,documentType,title,markdown,generationStatus,provider,model,refs,coverage] = args
        documents.push({id,projectId,creatorId,documentType,title,markdown,generationStatus,provider,model,sourceReferences:JSON.parse(refs),coverage:JSON.parse(coverage),failureCode:null})
        return rows([])
      }
      if (sql.startsWith('SELECT count')) return rows([{total:documents.filter(d=>d.projectId===args[0]).length}])
      if (sql.startsWith('SELECT') && sql.includes('FROM project_documents')) {
        let found = documents.filter(d=>args[1]===owner && (sql.includes('WHERE d.id=$1') ? d.id===args[0] : d.projectId===args[0]))
        if (sql.includes('LIMIT')) found = found.slice(args[3],args[3]+args[2]).map(({markdown,...d})=>d)
        return rows(structuredClone(found))
      }
      if (sql.startsWith('UPDATE project_documents') && sql.includes("interval '10 minutes'")) return rows([])
      if (sql.startsWith('UPDATE project_documents')) {
        if (failUpdate) throw new Error('SQL failure with sensitive parameters')
        const d = documents.find(d=>d.id===args[0])
        if (sql.includes('title=COALESCE')) { d.title=args[1]??d.title; d.markdown=args[2]??d.markdown }
        if (sql.includes("generation_status='Running'")) d.generationStatus='Running'
        if (sql.includes("generation_status='Completed'")) { d.generationStatus='Completed';d.markdown=args[1];d.coverage=JSON.parse(args[2]);if(args[3])d.sourceReferences=JSON.parse(args[3]) }
        if (sql.includes("generation_status='Failed'")) { d.generationStatus='Failed';d.failureCode=args[1] }
        return rows([])
      }
      if (sql.startsWith('DELETE FROM project_documents')) { documents=documents.filter(d=>d.id!==args[0]);return rows([]) }
      throw new Error(`Unhandled test SQL: ${sql}`)
    },
  }
  return {pool,owner,other,file,fileId,calls,breakUpdates(){failUpdate=true},breakCommit(){failCommit=true},repo:createDocumentRepository(pool)}
}
async function fixture() {
  const db = database(), users = createTestRepository()
  const owner = {id:db.owner,email:'docs-owner@example.test',role:'Developer'}
  const other = {id:db.other,email:'docs-manager@example.test',role:'Project Manager'}
  await users.createUser(owner);await users.createUser(other)
  return {...db,users,app:createApp({userRepository:users,documentRepository:db.repo}),token:signToken(owner),otherToken:signToken(other)}
}
const payload = {projectId:'owned',documentType:'readme',title:'README',markdown:'# Actual draft'}
const generation = db => ({projectId:'owned',documentType:'readme',title:'Future README',provider:'gemini',model:'test-model',fileIds:[db.fileId]})
const completeCoverage = {filesSubmitted:1,filesIncluded:1,filesSkipped:0,filesFailed:0,truncated:false}
test('JWT required; owner CRUD, Markdown download, pagination and recreated repository persistence',async()=>{
  const f=await fixture(), base='/api/project-documents'
  assert.equal((await request(f.app).get(base)).status,401)
  for (const [method,url] of [['post',base],['get',`${base}/${crypto.randomUUID()}`],['get',`${base}/${crypto.randomUUID()}/markdown`],['patch',`${base}/${crypto.randomUUID()}`],['delete',`${base}/${crypto.randomUUID()}`]]) assert.equal((await request(f.app)[method](url).send(payload)).status,401)
  const created=await request(f.app).post(base).set('Authorization',`Bearer ${f.token}`).send(payload)
  assert.equal(created.status,201);const id=created.body.document.id
  assert.equal(created.body.document.generationStatus,'Draft');assert.equal(created.body.document.provider,null)
  await f.repo.create({...payload,title:'Second'},f.owner)
  const list=await request(f.app).get(`${base}?projectId=owned&limit=1&offset=1`).set('Authorization',`Bearer ${f.token}`)
  assert.equal(list.status,200);assert.equal(list.body.total,2);assert.equal(list.body.documents.length,1);assert.equal(list.body.documents[0].markdown,undefined)
  const restarted=createApp({userRepository:f.users,documentRepository:createDocumentRepository(f.pool)})
  const download=await request(restarted).get(`${base}/${id}/markdown`).set('Authorization',`Bearer ${f.token}`)
  assert.equal(download.status,200);assert.match(download.headers['content-type'],/text\/markdown/);assert.match(download.headers['content-disposition'],/^attachment/);assert.equal(download.headers['x-content-type-options'],'nosniff');assert.equal(download.text,payload.markdown)
  const updated=await request(restarted).patch(`${base}/${id}`).set('Authorization',`Bearer ${f.token}`).send({title:'Edited',markdown:'<script>untrusted()</script>'})
  assert.equal(updated.status,200);assert.equal(updated.body.document.title,'Edited')
  assert.equal((await request(restarted).delete(`${base}/${id}`).set('Authorization',`Bearer ${f.token}`)).status,204)
  assert.equal(await f.repo.read(id,f.owner),null)
})
test('manager and lead cannot access another owner documents',async()=>{
  const f=await fixture(), doc=await f.repo.create(payload,f.owner),base='/api/project-documents'
  const lead={id:crypto.randomUUID(),email:'docs-lead@example.test',role:'Team Lead'}
  await f.users.createUser(lead)
  assert.equal((await request(f.app).get(`${base}/${doc.id}`).set('Authorization',`Bearer ${signToken(lead)}`)).status,404)
  for (const [method,url,body] of [['post',base,payload],['get',`${base}?projectId=owned`],['get',`${base}/${doc.id}`],['get',`${base}/${doc.id}/markdown`],['patch',`${base}/${doc.id}`,{title:'Stolen'}],['delete',`${base}/${doc.id}`]]) {
    let call=request(f.app)[method](url).set('Authorization',`Bearer ${f.otherToken}`)
    if(body) call=call.send(body)
    assert.equal((await call).status,404)
  }
  assert.equal((await f.repo.read(doc.id,f.owner)).title,'README')
})
test('invalid types, server metadata, payloads, lengths, pagination and statuses rejected',async()=>{
  const f=await fixture()
  for (const body of [{...payload,documentType:'invented'},{...payload,generationStatus:'Completed'},{...payload,provider:'gemini'},{...payload,sourceReferences:[]},{...payload,coverage:{}},{...payload,title:' '},{...payload,title:'x'.repeat(201)},{...payload,markdown:'x'.repeat(50001)},[],null]) {
    assert.throws(()=>v.draft(body),e=>e.code==='invalid_request')
  }
  for (const query of ['limit=51','limit=0','offset=-1','limit=1.5','limit=2&limit=3','projectId=other&unknown=1']) {
    const url=query.startsWith('projectId')?query:`projectId=owned&${query}`
    assert.equal((await request(f.app).get(`/api/project-documents?${url}`).set('Authorization',`Bearer ${f.token}`)).status,400)
  }
  const d=await f.repo.create(payload,f.owner)
  assert.equal((await request(f.app).patch(`/api/project-documents/${d.id}`).set('Authorization',`Bearer ${f.token}`).send({generationStatus:'Running'})).status,400)
  assert.throws(()=>v.generation({...generation(f),fileIds:[f.fileId,f.fileId]}))
  assert.throws(()=>v.generation({...generation(f),provider:'openrouter'}))
  assert.throws(()=>v.coverage({...completeCoverage,filesIncluded:0},1))
})
test('internal generation snapshots authoritative metadata; guarded transitions and immutable generated content',async()=>{
  const f=database(),d=await f.repo.prepareGeneration(generation(f),f.owner)
  assert.equal(d.generationStatus,'Pending');assert.deepEqual(d.sourceReferences,[f.file])
  await assert.rejects(f.repo.completeGeneration(d.id,f.owner,'# Doc',completeCoverage),e=>e.code==='document_state_conflict')
  await assert.rejects(f.repo.startGeneration(d.id,f.other),e=>e.code==='not_found')
  await f.repo.startGeneration(d.id,f.owner)
  await assert.rejects(f.repo.remove(d.id,f.owner),e=>e.code==='document_state_conflict')
  await assert.rejects(f.repo.completeGeneration(d.id,f.owner,'# Doc',completeCoverage,[{fileId:f.fileId,path:'other.js',lineStart:1,lineEnd:1}]),e=>e.code==='invalid_request')
  const completed=await f.repo.completeGeneration(d.id,f.owner,'# Doc',completeCoverage,[{fileId:f.fileId,path:f.file.path,lineStart:1,lineEnd:1}])
  assert.equal(completed.generationStatus,'Completed');assert.equal(completed.coverage.filesIncluded,1)
  assert.deepEqual(completed.sourceReferences[0].lineRanges,[{lineStart:1,lineEnd:1}])
  await assert.rejects(f.repo.failGeneration(d.id,f.owner,'ai_timeout'),e=>e.code==='document_state_conflict')
  await assert.rejects(f.repo.update(d.id,f.owner,{markdown:'fake'}),e=>e.code==='document_state_conflict')
  const pending=await f.repo.prepareGeneration(generation(f),f.owner)
  assert.equal((await f.repo.failGeneration(pending.id,f.owner,'ai_timeout')).failureCode,'ai_timeout')
  await assert.rejects(f.repo.failGeneration(pending.id,f.owner,'raw secret'),e=>e.code==='invalid_request')
})
test('source changes and SQL failures rollback without claiming successful persistence',async()=>{
  const f=database(),d=await f.repo.prepareGeneration(generation(f),f.owner)
  await f.repo.startGeneration(d.id,f.owner);f.file.hash='b'.repeat(64)
  await assert.rejects(f.repo.completeGeneration(d.id,f.owner,'# Wrong',completeCoverage),e=>e.code==='source_changed')
  assert.equal((await f.repo.read(d.id,f.owner)).generationStatus,'Running')
  f.breakUpdates()
  await assert.rejects(f.repo.failGeneration(d.id,f.owner,'ai_timeout'))
  assert.equal((await f.repo.read(d.id,f.owner)).generationStatus,'Running')
  assert.ok(f.calls.some(c=>c.sql==='ROLLBACK'))
  assert.ok(f.calls.filter(c=>c.sql.includes('FROM source_files')).every(c=>!c.sql.includes('content')))
})
test('creation rollback leaves no record; invalid or cross-project source references cannot be persisted',async()=>{
  const f=database()
  await assert.rejects(f.repo.prepareGeneration({...generation(f),fileIds:[crypto.randomUUID()]},f.owner),e=>e.code==='not_found')
  await assert.rejects(f.repo.prepareGeneration(generation(f),f.other),e=>e.code==='not_found')
  f.breakCommit()
  await assert.rejects(f.repo.create(payload,f.owner))
  assert.equal(f.calls.filter(c=>c.sql==='ROLLBACK').length,3)
  assert.equal((await f.pool.query('SELECT count(*) AS total FROM project_documents WHERE project_id=$1',['owned'])).rows[0].total,0)
})
test('storage failures sanitized without legacy-memory fallback',async()=>{
  const f=await fixture(),app=createApp({userRepository:f.users,documentRepository:{async create(){throw new Error('password=secret connection string')}}})
  const result=await request(app).post('/api/project-documents').set('Authorization',`Bearer ${f.token}`).send(payload)
  assert.equal(result.status,503);assert.equal(result.body.code,'document_storage_unavailable');assert.doesNotMatch(JSON.stringify(result.body),/password|secret connection/)
})
