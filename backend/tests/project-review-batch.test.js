require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const request = require('supertest')
const config = require('../src/config')
config.aiProvider = 'gemini'; config.geminiModel = 'test-model'
const { createReviewBatchRepository, coverage, aggregateStatus } = require('../src/db/reviewBatchRepository')
const { prepareProjectManifest } = require('../src/services/reviewDiscovery')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const { createReviewBatchWorker } = require('../src/services/reviewBatchWorker')
function meta(path, overrides = {}) {
  return { id: crypto.randomUUID(), path, language: 'JavaScript', byteSize: 10, characterCount: 10, lineCount: 1, sha256: 'a'.repeat(64), ...overrides }
}
// Explicit transactional SQL double. PostgreSQL syntax is checked separately; no dev records.
function database(files) {
  const owner = crypto.randomUUID(), other = crypto.randomUUID(), calls = []
  let state = { batches: [], files: [] }, tail = Promise.resolve(), failOrdinal = null
  const source = { files, totalBytes: null, totalFiles: null }
  const findings = []
  function clone(value) { return structuredClone(value) }
  const pool = { async connect() {
    let local = null, releaseLock, readOnly = false
    function done() { if (releaseLock) { releaseLock(); releaseLock = null } }
    return { release: done, async query(sql, args = []) {
      calls.push({ sql, args })
      if (sql.startsWith('BEGIN')) { readOnly = sql.includes('READ ONLY'); local = clone(state); return { rows: [] } }
      if (sql.startsWith('SET LOCAL')) return { rows: [] }
      if (sql.includes('pg_advisory_xact_lock')) {
        const previous = tail; tail = new Promise((resolve) => { releaseLock = resolve }); await previous
        local = clone(state); return { rows: [] }
      }
      if (sql === 'COMMIT') { if (!readOnly) state = local; done(); return { rows: [] } }
      if (sql === 'ROLLBACK') { local = null; done(); return { rows: [] } }
      if (sql.startsWith('SELECT id FROM source_projects')) return { rows: ['p', 'p2'].includes(args[0]) && args[1] === owner ? [{ id: args[0] }] : [] }
      if (sql.startsWith('SELECT * FROM repository_review_batches')) return { rows: local.batches.filter((b) => b.owner_id === args[0] && b.idempotency_key === args[1]) }
      if (sql.startsWith('SELECT file_id FROM')) return { rows: local.files.filter((f) => f.batchId === args[0]).map((f) => ({ file_id: f.fileId })).sort((a, b) => a.file_id.localeCompare(b.file_id)) }
      if (sql.startsWith('SELECT count(*)::int AS count FROM repository_review_batches')) return { rows: [{ count: local.batches.filter((b) => b.owner_id === args[0] && ['Queued', 'In Progress'].includes(b.status)).length }] }
      if (sql.includes('count(f.id)')) return { rows: [{ id: 'p', name: 'Project', totalFiles: String(source.totalFiles ?? source.files.length), totalBytes: String(source.totalBytes ?? source.files.reduce((sum, f) => sum + f.byteSize, 0)) }] }
      if (sql.startsWith('SELECT f.id,f.path')) return { rows: source.files.map((f) => ({ id: f.id, path: f.path, language: f.language, sha256: f.sha256, byteSize: f.byteSize, characterCount: f.characterCount, lineCount: f.lineCount })) }
      if (sql.startsWith('SELECT id FROM source_files')) return { rows: [{ id: args[0] }] }
      if (sql.startsWith('INSERT INTO repository_review_batches')) {
        local.batches.push({ id: args[0], project_id: args[1], owner_id: args[2], options: JSON.parse(args[3]), scope: args[6], provider: 'gemini', model: args[4], status: args[7], idempotency_key: args[5], createdAt: '2026-01-01T00:00:00Z' })
        return { rows: [] }
      }
      if (sql.startsWith('INSERT INTO repository_review_batch_files')) {
        if (args[6] === failOrdinal) throw Object.assign(new Error('private SQL failure'), { code: '23514' })
        local.files.push({ batchId: args[0], fileId: args[1], path: args[2], sourceHash: args[3], bytes: args[4], lines: args[5], ordinal: args[6], status: args[7], errorCode: args[8], attempts: 0 })
        return { rows: [] }
      }
      if (sql.startsWith('SELECT b.id,b.project_id')) {
        const b = local.batches.find((b) => b.id === args[0] && b.owner_id === args[1])
        return { rows: b ? [{ id: b.id, projectId: b.project_id, project: 'Project', scope: b.scope, options: b.options, provider: b.provider, model: b.model, status: b.status }] : [] }
      }
      if (sql.startsWith('SELECT f.file_id')) return { rows: local.files.filter((f) => f.batchId === args[0]).sort((a, b) => a.ordinal - b.ordinal).map((f) => ({ ...f })) }
      if (sql.startsWith('SELECT count(*)::int AS count FROM repository_review_batch_files')) return { rows: [{ count: findings.length }] }
      if (sql.startsWith('SELECT fi.id')) return { rows: findings.slice(args[3], args[3] + args[2]).map(({ code, suggestedCode, ...summary }) => summary) }
      throw new Error('Unexpected test SQL')
    } }
  }, async query(sql, args) {
    calls.push({ sql, args })
    if (sql.includes('ORDER BY b.created_at DESC LIMIT 100')) return { rows: state.batches.filter((b) => b.owner_id === args[0]).map((b) => ({ id: b.id, scope: b.scope, coverage: coverage(state.files.filter((f) => f.batchId === b.id)), files: b.scope === 'Entire Project' ? [] : state.files.filter((f) => f.batchId === b.id), findingsCount: findings.length })) }
    throw new Error('Unexpected test pool SQL')
  } }
  const repo = createReviewBatchRepository(pool)
  return { repo, pool, owner, other, calls, source, findings, state: () => state, failAt: (ordinal) => { failOrdinal = ordinal },
    input: (overrides = {}) => ({ projectId: 'p', scope: 'Entire Project', options: { focus: 'General' }, model: 'test-model', idempotencyKey: 'request', ...overrides }) }
}
test('four-file project creates an atomic ordered metadata-only Pending/Skipped manifest', async () => {
  const records = [meta('z.js'), meta('skip.json'), meta('a.js'), meta('big.js', { characterCount: 50001 })]
  for (const record of records) Object.defineProperty(record, 'content', { get() { assert.fail('Must not load source text') } })
  const db = database(records), result = await db.repo.enqueue(db.input(), db.owner)
  assert.equal(result.scope, 'Entire Project')
  assert.deepEqual(result.coverage, { submitted: 4, pending: 2, running: 0, reviewed: 0, skipped: 2, failed: 0 })
  assert.deepEqual(result.files.map((f) => f.path), ['a.js', 'big.js', 'skip.json', 'z.js'])
  assert.deepEqual(db.state().files.map((f) => f.ordinal), [0, 1, 2, 3])
  assert.equal(result.files[1].errorCode, 'source_character_limit')
  assert.equal(result.files[2].errorCode, 'unsupported_file')
  assert.ok(db.calls.some((c) => c.sql.includes('FOR UPDATE') && c.sql.includes('source_projects')))
  assert.ok(db.calls.some((c) => c.sql.includes('SELECT f.id') && c.sql.endsWith('FOR SHARE OF f')))
  assert.ok(!db.calls.some((c) => c.sql.includes('AND content=$5')))
  assert.ok(!JSON.stringify(result).includes('content'))
})
test('exactly 200 files and 10 MiB are supported; 201 files and excess total bytes reject without insertion', async () => {
  const rows = Array.from({ length: 200 }, (_, i) => meta(`src/${String(i).padStart(3, '0')}.js`))
  const db = database(rows)
  assert.equal((await db.repo.enqueue(db.input(), db.owner)).files.length, 200)
  for (const source of [rows.concat(meta('extra.js')), Array.from({ length: 21 }, (_, i) => meta(`${i}.js`, { byteSize: 524288 }))]) {
    const over = database(source)
    await assert.rejects(over.repo.enqueue(over.input(), over.owner), (e) => e.status === 413)
    assert.equal(over.state().batches.length, 0)
    assert.ok(!over.calls.some((c) => c.sql.startsWith('INSERT')))
  }
  const exact = database(Array.from({ length: 20 }, (_, i) => meta(`${i}.js`, { byteSize: 524288, characterCount: 524288 })))
  const result = await exact.repo.enqueue(exact.input(), exact.owner)
  assert.equal(result.coverage.skipped, 20)
})
test('all-skipped project is durably Failed with no queued jobs; empty and duplicate projects roll back', async () => {
  const db = database([meta('one.json'), meta('two.js', { lineCount: 10001 })])
  const result = await db.repo.enqueue(db.input(), db.owner)
  assert.equal(result.status, 'Failed')
  assert.equal(db.state().batches[0].status, 'Failed')
  assert.equal(result.coverage.pending, 0)
  assert.ok(result.files.every((f) => f.status === 'Skipped' && f.attempts === 0))
  const empty = database([])
  await assert.rejects(empty.repo.enqueue(empty.input(), empty.owner), (e) => e.code === 'empty_source_project')
  assert.equal(empty.state().batches.length, 0)
  const a = meta('a.js'), duplicate = database([a, { ...a, path: 'b.js' }])
  await assert.rejects(duplicate.repo.enqueue(duplicate.input(), duplicate.owner), (e) => e.code === 'source_metadata_conflict')
})
test('mid-manifest SQL failure rolls back the parent and every file', async () => {
  const db = database([meta('a.js'), meta('b.js'), meta('c.js'), meta('d.js')]); db.failAt(2)
  await assert.rejects(db.repo.enqueue(db.input(), db.owner), (e) => e.code === '23514')
  assert.equal(db.state().batches.length, 0); assert.equal(db.state().files.length, 0)
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK')
})
test('concurrent idempotency reuses original manifest even after uploads, without rediscovery', async () => {
  const db = database([meta('a.js'), meta('b.js'), meta('c.js'), meta('d.js')])
  const [a, b] = await Promise.all([db.repo.enqueue(db.input(), db.owner), db.repo.enqueue(db.input(), db.owner)])
  assert.equal(a.id, b.id); assert.equal(db.state().batches.length, 1)
  const discoveries = db.calls.filter((c) => c.sql.startsWith('SELECT f.id')).length
  db.source.files = []; db.source.totalFiles = 201 // New project contents must not invalidate replay.
  const replay = await db.repo.enqueue(db.input(), db.owner)
  assert.equal(replay.id, a.id); assert.equal(replay.files.length, 4)
  assert.equal(db.calls.filter((c) => c.sql.startsWith('SELECT f.id')).length, discoveries)
  for (const input of [db.input({ scope: 'Selected Files', files: [meta('a.js')] }), db.input({ options: { focus: 'Security' } }), db.input({ projectId: 'p2' })]) await assert.rejects(db.repo.enqueue(input, db.owner), (e) => e.code === 'idempotency_conflict')
  await assert.rejects(db.repo.enqueue(db.input(), db.other), (e) => e.status === 404)
})
test('project responses page summaries, omit source evidence, and keep list manifests bounded', async () => {
  const db = database([meta('a.js'), meta('b.js'), meta('c.js'), meta('d.js')])
  const batch = await db.repo.enqueue(db.input(), db.owner)
  db.findings.push(...Array.from({ length: 61 }, (_, i) => ({ id: `f-${i}`, file: 'a.js', line: '1', problem: 'p', code: 'private source evidence', suggestedCode: 'private source suggestion' })))
  const first = await db.repo.read(batch.id, db.owner)
  assert.equal(first.findings.length, 50); assert.equal(first.findingsCount, 61)
  assert.equal(first.findingsPage.nextOffset, 50)
  const next = await db.repo.read(batch.id, db.owner, true, 50)
  assert.equal(next.findings.length, 11); assert.equal(next.findingsPage.hasMore, false)
  assert.ok(!JSON.stringify(first).includes('private source'))
  const list = await db.repo.list(db.owner)
  assert.deepEqual(list[0].files, []); assert.equal(list[0].coverage.submitted, 4)
  assert.equal(list[0].manifestIncluded, false)
})
test('full-project API rejects browser snapshots/IDs, owns requests and never reads source text', async () => {
  const db = database([meta('a.js'), meta('b.js'), meta('c.js'), meta('d.js')])
  const users = createTestRepository(), owner = { id: db.owner, email: 'project-owner@example.com', role: 'Developer' }, other = { id: db.other, email: 'project-manager@example.com', role: 'Project Manager' }
  await users.createUser(owner); await users.createUser(other)
  const sources = { async findProject(id, uid) { return id === 'p' && uid === db.owner ? { id } : null }, async readFile() { assert.fail('Full project must not load text in HTTP route') } }
  const app = createApp({ userRepository: users, sourceRepository: sources, reviewBatchRepository: db.repo })
  let ip = 1
  const post = (body, user = owner) => request(app).post('/api/repository-review-batches').set('X-Forwarded-For', `192.0.2.${ip++}`).set('Authorization', `Bearer ${signToken(user)}`).send(body)
  const body = { projectId: 'p', scope: 'Entire Project', idempotencyKey: 'api' }
  assert.equal((await request(app).post('/api/repository-review-batches').send(body)).status, 401)
  assert.equal((await post(body, other)).status, 404)
  for (const extra of [{ fileIds: [] }, { fileId: crypto.randomUUID() }, { files: [] }, { path: 'a.js' }, { code: 'browser source' }, { snapshot: {} }]) assert.equal((await post({ ...body, ...extra })).status, 400)
  const result = await post(body)
  assert.equal(result.status, 202); assert.equal(result.body.batch.scope, 'Entire Project')
  assert.equal(result.body.batch.files.length, 4)
})
test('actual worker skips changed source before analysis and retains timeout code/retry semantics', async () => {
  for (const mode of ['changed', 'deleted', 'unsafe', 'timeout']) {
    const content = 'const value = 1;', source = { id: crypto.randomUUID(), path: 'a.js', content, language: 'JavaScript', sha256: crypto.createHash('sha256').update(content).digest('hex') }
    const job = { batch_id: crypto.randomUUID(), file_id: source.id, ownerId: crypto.randomUUID(), projectId: 'p', path: source.path, source_sha256: source.sha256,
      byte_count: Buffer.byteLength(content), line_count: 1, token: crypto.randomUUID(), attempt: 1, model: 'test-model', options: { focus: 'General' } }
    if (mode === 'changed') source.sha256 = '0'.repeat(64)
    if (mode === 'unsafe') source.path = '.env'
    const outcomes = []
    const batches = { async claim() { return job }, async attachReview() { return 'child' }, async finish(j, result) { outcomes.push(result); return true } }
    const sources = { async findProject() { return { id: 'p' } }, async readFile() { return mode === 'deleted' ? null : source } }
    await createReviewBatchWorker({ batches, sources, configuration: { aiProvider: 'gemini', geminiModel: 'test-model' }, analyze: async () => {
      assert.equal(mode, 'timeout'); throw Object.assign(new Error('private provider text'), { code: 'ai_timeout' })
    } }).runOnce()
    if (mode === 'timeout') { assert.equal(outcomes[0].code, 'ai_timeout'); assert.equal(outcomes[0].retry, true) }
    else assert.equal(outcomes[0].skipped, true)
  }
})

test('created project uses sequential per-file processing, bounded retry, zero findings and partial coverage', async () => {
  const sources = ['a.js', 'b.js', 'c.js'].map((path) => {
    const content = `export const name='${path}';`
    return { id: crypto.randomUUID(), path, language: 'JavaScript', content, sha256: crypto.createHash('sha256').update(content).digest('hex') }
  })
  const rows = sources.map((s) => meta(s.path, { id: s.id, byteSize: Buffer.byteLength(s.content), characterCount: s.content.length, lineCount: 1, sha256: s.sha256 }))
  rows.push(meta('ignored.json'))
  const db = database(rows), batch = await db.repo.enqueue(db.input(), db.owner)
  let active = 0, maxActive = 0, analyses = 0
  const stored = db.state().files
  const batches = {
    async claim() {
      if (stored.some((f) => f.status === 'Running')) return null
      const f = stored.find((f) => f.status === 'Pending')
      if (!f) return null
      f.status = 'Running'; f.attempts++
      return { batch_id: batch.id, file_id: f.fileId, projectId: 'p', ownerId: db.owner, path: f.path, source_sha256: f.sourceHash,
        byte_count: f.bytes, line_count: f.lines, attempt: f.attempts, token: crypto.randomUUID(), model: 'test-model', options: { focus: 'General' } }
    },
    async attachReview() { return crypto.randomUUID() },
    async finish(job, output) {
      const f = stored.find((f) => f.fileId === job.file_id)
      f.status = Array.isArray(output.findings) ? 'Reviewed' : output.skipped ? 'Skipped' : output.retry && f.attempts < 2 ? 'Pending' : 'Failed'
      f.errorCode = output.code || null
      return true
    },
  }
  const worker = createReviewBatchWorker({ batches, configuration: { aiProvider: 'gemini', geminiModel: 'test-model' }, sources: {
    async findProject() { return { id: 'p' } }, async readFile(pid, id) { assert.equal(pid, 'p'); return sources.find((s) => s.id === id) },
  }, analyze: async (input) => {
    active++; maxActive = Math.max(maxActive, active); analyses++
    await new Promise((resolve) => setImmediate(resolve))
    active--
    if (input.file === 'b.js') throw Object.assign(new Error('private timeout response'), { code: 'ai_timeout' })
    assert.equal(input.code, sources.find((s) => s.path === input.file).content)
    return []
  } })
  await Promise.all([worker.runOnce(), worker.runOnce()])
  while (await worker.runOnce()) { /* drain deterministic test-only queue */ }
  assert.equal(maxActive, 1)
  assert.equal(analyses, 4) // a/c once; b at most twice; excluded file never analyzed.
  assert.deepEqual(coverage(stored), { submitted: 4, pending: 0, running: 0, reviewed: 2, skipped: 1, failed: 1 })
  assert.equal(aggregateStatus(coverage(stored)), 'Partial')
  assert.equal(stored.find((f) => f.path === 'b.js').errorCode, 'ai_timeout')
  assert.equal(stored.find((f) => f.path === 'ignored.json').attempts, 0)
  assert.equal(aggregateStatus(coverage([{ status: 'Reviewed' }, { status: 'Reviewed' }])), 'Completed')
})
test('combined entire-project batches are accepted atomically and idempotency distinguishes focus',async()=>{
 const db=database([meta('a.js'),meta('b.js'),meta('c.js'),meta('d.js')])
 const input=db.input({options:{focus:'BugsAndSecurity'}})
 const [first,replay]=await Promise.all([db.repo.enqueue(input,db.owner),db.repo.enqueue(input,db.owner)])
 assert.equal(first.id,replay.id);assert.equal(first.options.focus,'BugsAndSecurity');assert.equal(first.files.length,4);assert.equal(db.state().batches.length,1)
 for(const focus of ['Bugs','Security','General'])await assert.rejects(db.repo.enqueue({...input,options:{focus}},db.owner),e=>e.code==='idempotency_conflict')
 const discoveries=db.calls.filter(c=>c.sql.startsWith('SELECT f.id')).length
 db.source.files=[];db.source.totalFiles=201
 assert.equal((await db.repo.enqueue(input,db.owner)).id,first.id)
 assert.equal(db.calls.filter(c=>c.sql.startsWith('SELECT f.id')).length,discoveries)
})
test('full-project POST accepts combined focus without loading source or calling Gemini',async()=>{
 const db=database([meta('a.js'),meta('b.js'),meta('c.js'),meta('d.js')])
 const owner={id:db.owner,email:'combined-owner@example.com',role:'Developer'},users=createTestRepository();await users.createUser(owner)
 const app=createApp({userRepository:users,sourceRepository:{findProject:async(id,uid)=>id==='p'&&uid===db.owner ? {id}:null,readFile:async()=>assert.fail('No creation-time source loading')},reviewBatchRepository:db.repo})
 const body={projectId:'p',scope:'Entire Project',options:{focus:'BugsAndSecurity'},idempotencyKey:'combined-api'}
 const post=(payload)=>request(app).post('/api/repository-review-batches').set('Authorization',`Bearer ${signToken(owner)}`).send(payload)
 const result=await post(body);assert.equal(result.status,202);assert.equal(result.body.batch.options.focus,'BugsAndSecurity');assert.equal(result.body.batch.files.length,4)
 assert.equal((await post(body)).body.batchId,result.body.batchId)
 assert.equal((await post({...body,options:{focus:'Security'}})).status,409)
 assert.equal((await post({...body,options:{focus:'Unsupported'}})).status,400)
})
test('project custom focus is durable and normalized idempotency distinguishes actual selections',async()=>{
 const db=database([meta('a.js'),meta('b.js'),meta('c.js'),meta('d.js')])
 const input=db.input({options:{focus:'BugsAndSecurity',analysisFocus:{bugs:['logic_errors','error_handling'],security:['xss','sql_injection']}}})
 const reversed={...input,options:{focus:'BugsAndSecurity',analysisFocus:{bugs:['error_handling','logic_errors'],security:['sql_injection','xss']}}}
 const [a,b]=await Promise.all([db.repo.enqueue(input,db.owner),db.repo.enqueue(reversed,db.owner)])
 assert.equal(a.id,b.id);assert.equal(db.state().batches.length,1)
 assert.deepEqual(a.options,reversed.options)
 const restarted=require('../src/db/reviewBatchRepository').createReviewBatchRepository(db.pool)
 assert.deepEqual((await restarted.read(a.id,db.owner)).options,reversed.options)
 await assert.rejects(db.repo.enqueue({...input,options:{focus:'BugsAndSecurity',analysisFocus:{bugs:['logic_errors'],security:['xss']}}},db.owner),e=>e.code==='idempotency_conflict')
 await assert.rejects(db.repo.enqueue({...input,options:{focus:'BugsAndSecurity'}},db.owner),e=>e.code==='idempotency_conflict')
 const broadDb=database([meta('a.js')]),original=await broadDb.repo.enqueue(broadDb.input({options:{focus:'Bugs'}}),broadDb.owner)
 assert.equal((await broadDb.repo.enqueue(broadDb.input({options:{focus:'Bugs',analysisFocus:{bugs:[],security:[]}}}),broadDb.owner)).id,original.id)
})
test('full-project API accepts structured priorities but rejects prompt text and invalid groups',async()=>{
 const db=database([meta('a.js')]),users=createTestRepository(),owner={id:db.owner,email:'priorities-owner@example.com',role:'Developer'};await users.createUser(owner)
 const app=createApp({userRepository:users,sourceRepository:{findProject:async()=>({id:'p'}),readFile:async()=>assert.fail('No source read for project creation')},reviewBatchRepository:db.repo})
 const post=body=>request(app).post('/api/repository-review-batches').set('Authorization',`Bearer ${signToken(owner)}`).send(body)
 for(const analysisFocus of [{bugs:['unknown']},{security:['xss']},{bugs:['logic_errors','logic_errors']},{prompt:'arbitrary prompt'}])assert.equal((await post({projectId:'p',scope:'Entire Project',options:{focus:'Bugs',analysisFocus}})).status,400)
 const result=await post({projectId:'p',scope:'Entire Project',options:{focus:'Security',analysisFocus:{security:['xss','sql_injection']}},idempotencyKey:'priorities-api'})
 assert.equal(result.status,202);assert.deepEqual(result.body.batch.options.analysisFocus,{bugs:[],security:['sql_injection','xss']})
})
