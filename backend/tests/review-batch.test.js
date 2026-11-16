require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const request = require('supertest')
const config = require('../src/config')
Object.assign(config, { aiProvider: 'gemini', geminiApiKey: 'test-key', geminiModel: 'test-model', geminiTimeoutMs: 1000 })
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const { createReviewBatchWorker } = require('../src/services/reviewBatchWorker')
const { createReviewBatchRepository, coverage, aggregateStatus, LEASE_SECONDS } = require('../src/db/reviewBatchRepository')
const { validateReviewSource } = require('../src/services/reviewSource')

function source(path = 'src/a.js') {
  const content = 'export const add = (a, b) => a + b;'
  return { id: crypto.randomUUID(), path, content, language: 'JavaScript', sha256: crypto.createHash('sha256').update(content).digest('hex') }
}
async function apiFixture() {
  const owner = { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, role: 'Developer' }
  const other = { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, role: 'Project Manager' }
  const users = createTestRepository(); await users.createUser(owner); await users.createUser(other)
  const files = [source(), source('src/b.ts'), source('src/c.js'), source('src/d.js')]
  const sources = { async findProject(id, uid) { return id === 'p' && uid === owner.id ? { id } : null }, async readFile(pid, fid, uid) { return pid === 'p' && uid === owner.id ? files.find((f) => f.id === fid) : null } }
  const records = new Map()
  const batches = {
    async enqueue(input, uid) {
      const existing = [...records.values()].find((b) => b.owner === uid && b.key === input.idempotencyKey)
      if (existing) return existing
      const batch = { id: crypto.randomUUID(), owner: uid, key: input.idempotencyKey, projectId: input.projectId, status: 'Queued', options: input.options,
        files: input.files.map((f) => ({ fileId: f.id, path: f.path, sourceHash: f.sourceHash, bytes: f.bytes, lines: f.lines, status: 'Pending' })) }
      batch.coverage = coverage(batch.files); records.set(batch.id, batch); return batch
    },
    async read(id, uid) { const b = records.get(id); return b?.owner === uid ? b : null },
    async list(uid) { return [...records.values()].filter((b) => b.owner === uid) },
  }
  const app = createApp({ userRepository: users, sourceRepository: sources, reviewBatchRepository: batches })
  return { app, files, sources, owner, other, users, batches, token: signToken(owner), otherToken: signToken(other) }
}
let ip = 1
function post(f, payload, token = f.token) { return request(f.app).post('/api/repository-review-batches').set('X-Forwarded-For', `192.0.2.${ip++}`).set('Authorization', `Bearer ${token}`).send(payload) }
test('batch API enqueues IDs-only authoritative manifest, replays key, and survives app recreation', async () => {
  const f = await apiFixture(), body = { projectId: 'p', fileIds: f.files.slice(0, 3).map((s) => s.id), idempotencyKey: 'same-request' }
  const result = await post(f, body)
  assert.equal(result.status, 202); assert.equal(result.body.batchId, result.body.batch.id)
  assert.deepEqual(result.body.batch.coverage, { submitted: 3, pending: 3, running: 0, reviewed: 0, skipped: 0, failed: 0 })
  assert.equal(result.body.batch.files[0].sourceHash, f.files[0].sha256)
  assert.ok(!JSON.stringify(result.body).includes(f.files[0].content))
  assert.equal((await post(f, body)).body.batchId, result.body.batchId)
  const restarted = createApp({ userRepository: f.users, sourceRepository: f.sources, reviewBatchRepository: f.batches })
  assert.equal((await request(restarted).get(`/api/repository-review-batches/${result.body.batchId}`).set('Authorization', `Bearer ${f.token}`)).status, 200)
})
test('JWT and owner-only reads/creation deny managers and unknown projects/files', async () => {
  const f = await apiFixture(), body = { projectId: 'p', fileIds: [f.files[0].id] }
  assert.equal((await request(f.app).post('/api/repository-review-batches').send(body)).status, 401)
  assert.equal((await post(f, body, f.otherToken)).status, 404)
  const id = (await post(f, body)).body.batchId
  assert.equal((await request(f.app).get(`/api/repository-review-batches/${id}`).set('Authorization', `Bearer ${f.otherToken}`)).status, 404)
  assert.deepEqual((await request(f.app).get('/api/repository-review-batches').set('Authorization', `Bearer ${f.otherToken}`)).body.batches, [])
  assert.equal((await post(f, { ...body, projectId: 'other-project' })).status, 404)
  assert.equal((await post(f, { ...body, fileIds: [f.files[0].id, crypto.randomUUID()] })).status, 404)
})
test('duplicate IDs, mixed project IDs, three-file cap, unsupported source and browser source are rejected', async () => {
  const f = await apiFixture(), body = { projectId: 'p', fileIds: [f.files[0].id] }
  assert.equal((await post(f, { ...body, fileIds: [f.files[0].id, f.files[0].id.toUpperCase()] })).status, 400)
  assert.equal((await post(f, { ...body, fileIds: f.files.map((s) => s.id) })).status, 400)
  assert.equal((await post(f, { ...body, fileIds: [] })).status, 400)
  assert.equal((await post(f, { ...body, code: 'do not trust me' })).status, 400)
  assert.equal((await post(f, { ...body, fileIds: [f.files[0].id, crypto.randomUUID()] })).status, 404)
  f.files[0].path = '.env'; assert.equal((await post(f, body)).status, 400)
  f.files[0].path = 'a.js'; f.files[0].sha256 = '0'.repeat(64); assert.equal((await post(f, body)).status, 409)
})
test('explicit selected scope preserves selected batches and history while rejecting invalid scopes', async () => {
  const f = await apiFixture(), payload = { projectId: 'p', fileIds: [f.files[0].id] }
  const original = await post(f, payload)
  assert.equal(original.status, 202)
  const explicit = await post(f, { ...payload, scope: 'Selected Files' })
  assert.equal(explicit.status, 202)
  const before = (await request(f.app).get('/api/repository-review-batches').set('Authorization', `Bearer ${f.token}`)).body
  assert.equal(before.batches.length, 2)
  for (const scope of ['Folder', '', null, ['Selected Files']]) {
    const response = await post(f, { ...payload, scope })
    assert.equal(response.status, 400)
  }
  const after = (await request(f.app).get('/api/repository-review-batches').set('Authorization', `Bearer ${f.token}`)).body
  assert.deepEqual(after, before)
  assert.equal((await post(f, { ...payload, scope: 'Selected Files', fileIds: f.files.map((file) => file.id) })).status, 400)
})
function workerFixture(file = source()) {
  const meta = validateReviewSource(file)
  const job = { batch_id: crypto.randomUUID(), file_id: file.id, ownerId: crypto.randomUUID(), projectId: 'p', options: { focus: 'General' }, model: 'test-model', token: crypto.randomUUID(), attempt: 1,
    path: file.path, source_sha256: meta.sourceHash, byte_count: meta.bytes, line_count: meta.lines }
  const outcomes = [], calls = []
  let claimed = false
  const batches = { async claim() { if (claimed) return null; claimed = true; return job }, async attachReview() { return crypto.randomUUID() }, async finish(j, outcome) { outcomes.push(outcome); calls.push(j); return true } }
  const sources = { async findProject() { return { id: 'p' } }, async readFile() { return file } }
  return { job, file, batches, sources, outcomes, configuration: config }
}
test('worker uses exact source and permits zero findings; concurrent calls do not duplicate a claimed job', async () => {
  const f = workerFixture(); let calls = 0
  const worker = createReviewBatchWorker({ ...f, analyze: async (input) => { calls++; assert.equal(input.code, f.file.content); assert.equal(input.file, f.file.path); return [] } })
  await Promise.all([worker.runOnce(), worker.runOnce()])
  assert.equal(calls, 1); assert.deepEqual(f.outcomes[0].findings, [])
  assert.equal(f.outcomes[0].content, f.file.content)
})
test('source changes, deleted source and revoked ownership skip before Gemini', async () => {
  for (const mode of ['hash', 'missing', 'owner', 'unsafe']) {
    const f = workerFixture()
    if (mode === 'hash') { f.file.content += '\n// changed'; f.file.sha256 = crypto.createHash('sha256').update(f.file.content).digest('hex') }
    if (mode === 'missing') f.sources.readFile = async () => null
    if (mode === 'owner') f.sources.findProject = async () => null
    if (mode === 'unsafe') f.file.path = '.env'
    await createReviewBatchWorker({ ...f, analyze: async () => { assert.fail('Gemini must not be called') } }).runOnce()
    assert.equal(f.outcomes[0].skipped, true)
  }
})
test('timeouts and quota/unavailable errors request bounded retries; permanent failures never retry or expose error text', async () => {
  for (const code of ['ai_timeout', 'ai_quota', 'ai_unavailable', 'ai_authentication', 'ai_malformed_response', 'unknown']) {
    const f = workerFixture()
    await createReviewBatchWorker({ ...f, analyze: async () => { throw Object.assign(new Error('private upstream body'), { code, retryAfterSeconds: 120 }) } }).runOnce()
    assert.equal(f.outcomes[0].retry, ['ai_timeout', 'ai_quota', 'ai_unavailable'].includes(code))
    assert.ok(!JSON.stringify(f.outcomes).includes('private'))
    assert.equal(f.outcomes[0].code, code === 'unknown' ? 'review_failed' : code)
  }
})
test('coverage includes every state and terminal status distinguishes partial, failed and empty-findings success', () => {
  const counts = coverage(['Pending', 'Running', 'Reviewed', 'Skipped', 'Failed'].map((status) => ({ status })))
  assert.equal(counts.submitted, counts.pending + counts.running + counts.reviewed + counts.skipped + counts.failed)
  assert.equal(aggregateStatus(coverage([{ status: 'Reviewed' }, { status: 'Failed' }])), 'Partial')
  assert.equal(aggregateStatus(coverage([{ status: 'Skipped' }, { status: 'Failed' }])), 'Failed')
  assert.equal(aggregateStatus(coverage([{ status: 'Reviewed' }])), 'Completed')
  assert.ok(LEASE_SECONDS * 1000 > 90000)
})
test('SQL completion is lease/token fenced; expired claim commits no findings or changes', async () => {
  const queries = []
  const client = { async query(sql) { queries.push(sql); return { rows: [] } }, release() {} }
  const repo = createReviewBatchRepository({ async connect() { return client } })
  assert.equal(await repo.finish({ batch_id: crypto.randomUUID(), file_id: crypto.randomUUID(), token: crypto.randomUUID() }, { findings: [] }), false)
  assert.ok(queries.some((q) => q.includes('lease_until>now()') && q.includes('claim_token=$3') && q.includes('FOR UPDATE')))
  assert.ok(!queries.some((q) => q.includes('INSERT INTO repository_review_findings')))
  assert.equal(queries.at(-1), 'COMMIT')
})
test('Gemini network quota retry guidance is sanitized and real timeout stays a failure', async () => {
  const { analyzeSource } = require('../src/services/gemini')
  const original = global.fetch
  try {
    global.fetch = async () => new Response('private body', { status: 429, headers: { 'Retry-After': '120' } })
    await assert.rejects(analyzeSource({ code: 'const x=1', language: 'javascript', file: 'a.js' }), (e) => e.code === 'ai_quota' && e.retryAfterSeconds === 120 && !e.message.includes('private'))
    global.fetch = (_, opts) => new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('private timeout'))))
    await assert.rejects(analyzeSource({ code: 'const x=1', language: 'javascript', file: 'a.js' }), (e) => e.code === 'ai_timeout')
  } finally { global.fetch = original }
})

test('SQL claims recover expired leases, serialize workers and use a fresh fencing token', async () => {
  const queries = [], parameters = []
  const row = { batch_id: crypto.randomUUID(), file_id: crypto.randomUUID(), attempt_count: 1 }
  const client = { async query(sql, args) {
    queries.push(sql); parameters.push(args)
    return { rows: sql.includes('FOR UPDATE OF f SKIP LOCKED') ? [row] : [] }
  }, release() {} }
  const repo = createReviewBatchRepository({ async connect() { return client } })
  const claimed = await repo.claim()
  assert.equal(claimed.attempt, 2)
  assert.match(claimed.token, /^[a-f0-9-]{36}$/)
  assert.ok(queries.some((q) => q.includes('pg_advisory_xact_lock')))
  assert.ok(queries.some((q) => q.includes("error_code='worker_interrupted'") && q.includes('lease_until<=now()')))
  const claimIndex = queries.findIndex((q) => q.includes("SET status='Running'"))
  assert.equal(parameters[claimIndex][2], claimed.token)
  assert.equal(parameters[claimIndex][3], LEASE_SECONDS)
  assert.equal(queries.at(-1), 'COMMIT')
})
test('SQL completion caps retries, commits zero findings as reviewed and discards changed-source output', async () => {
  for (const scenario of ['retry', 'exhausted', 'zero', 'changed']) {
    const queries = []
    const client = { async query(sql, args) {
      queries.push({ sql, args })
      if (sql.includes('SELECT * FROM repository_review_batch_files')) return { rows: [{ review_id: crypto.randomUUID(), attempt_count: scenario === 'exhausted' ? 2 : 1 }] }
      if (sql.includes('SELECT s.id FROM source_files')) return { rows: scenario === 'changed' ? [] : [{ id: 'valid' }] }
      return { rows: [] }
    }, release() {} }
    const repo = createReviewBatchRepository({ async connect() { return client } })
    const job = workerFixture().job
    const output = ['zero', 'changed'].includes(scenario) ? { findings: [], content: 'source' } : { code: 'ai_timeout', retry: true }
    assert.equal(await repo.finish(job, output), true)
    const update = queries.find((q) => q.sql.includes('SET status=$4::varchar(20),error_code=$5'))
    assert.equal(update.args[3], { retry: 'Pending', exhausted: 'Failed', zero: 'Reviewed', changed: 'Skipped' }[scenario])
    if (scenario === 'changed') assert.equal(update.args[4], 'source_changed_or_unavailable')
    if (scenario === 'zero') assert.ok(queries.some((q) => q.sql.includes("SET status='Completed'")))
    assert.equal(queries.at(-1).sql, 'COMMIT')
  }
})
test('batch storage failures are sanitized without leaking database messages', async () => {
  const f = await apiFixture()
  f.batches.list = async () => { throw new Error('private credential and database detail') }
  const response = await request(f.app).get('/api/repository-review-batches').set('Authorization', `Bearer ${f.token}`)
  assert.equal(response.status, 503)
  assert.equal(response.body.code, 'review_storage_unavailable')
  assert.ok(!JSON.stringify(response.body).includes('private'))
})

test('child creation renews the lease immediately before Gemini and rechecks durable ownership', async () => {
  const queries = []
  const client = { async query(sql, args) {
    queries.push({ sql, args })
    return { rows: sql.includes('SELECT f.file_id') ? [{ file_id: 'held' }] : [] }
  }, release() {} }
  const repo = createReviewBatchRepository({ async connect() { return client } })
  const child = await repo.attachReview(workerFixture().job)
  assert.match(child, /^[a-f0-9-]{36}$/)
  assert.ok(queries.some((q) => q.sql.includes('p.owner_id=b.owner_id') && q.sql.includes('lease_until>now()')))
  const renewal = queries.find((q) => q.sql.includes('SET review_id=$3,lease_until='))
  assert.equal(renewal.args[3], LEASE_SECONDS)
  assert.equal(queries.at(-1).sql, 'COMMIT')
})
test('empty source cannot receive a fabricated line-one finding', async () => {
  const { analyzeSource } = require('../src/services/gemini')
  const original = global.fetch
  const finding = { severity: 'Low', line: 1, category: 'Style', problem: 'p', explanation: 'e', improvement: 'i', suggestedCode: '' }
  try {
    global.fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ findings: [finding] }) }] } }] }))
    await assert.rejects(analyzeSource({ code: '', language: 'javascript', file: 'empty.js' }), (e) => e.code === 'ai_malformed_response')
    global.fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"findings":[]}' }] } }] }))
    assert.deepEqual(await analyzeSource({ code: '', language: 'javascript', file: 'empty.js' }), [])
  } finally { global.fetch = original }
})

test('rejected finalization is diagnosed once and never retries or reports successful processing', async () => {
  for (const phase of ['success_finalization', 'error_finalization', 'ownership_check', 'source_loading', 'source_validation', 'configuration_check', 'child_creation']) {
    const f = workerFixture(), entries = []
    let finishes = 0
    f.batches.finish = async () => { finishes++; return false }
    if (phase === 'ownership_check') f.sources.findProject = async () => null
    if (phase === 'source_loading') f.sources.readFile = async () => null
    if (phase === 'source_validation') f.job.source_sha256 = '0'.repeat(64)
    if (phase === 'configuration_check') f.configuration = { ...config, geminiModel: 'different-model' }
    if (phase === 'child_creation') f.batches.attachReview = async () => null
    const worker = createReviewBatchWorker({ ...f, diagnostic: (entry) => entries.push(entry), analyze: async () => {
      if (phase === 'error_finalization') throw Object.assign(new Error('private provider response'), { code: 'ai_timeout' })
      assert.equal(phase, 'success_finalization'); return []
    } })
    assert.equal(await worker.runOnce(), false)
    assert.equal(finishes, 1)
    assert.equal(entries.filter((e)=>e.event==='completion_rejected').length,1)
    assert.ok(!entries.some((e)=>e.event==='persistence_completed'))
    assert.equal(entries.at(-1).phase,phase)
    assert.equal(entries.at(-1).errorCategory,'stale_or_rejected_completion')
    assert.ok(!JSON.stringify(entries).includes(f.file.content))
    assert.ok(!JSON.stringify(entries).includes('private'))
  }
})

test('all finalization states use explicit varchar casts and commit child/file results in one transaction', async () => {
  const finding = { id: 'finding-test', severity: 'Low', category: 'Style', line: '1', problem: 'p', explanation: 'e', improvement: 'i', code: 'const x=1', suggestedCode: '' }
  const cases = [
    { state: 'Reviewed', output: { findings: [finding] } },
    { state: 'Reviewed', output: { findings: [] } },
    { state: 'Pending', output: { code: 'ai_timeout', retry: true } },
    { state: 'Skipped', output: { code: 'unsupported_file', skipped: true } },
    { state: 'Failed', output: { code: 'ai_timeout', retry: true }, attempt: 2 },
  ]
  for (const scenario of cases) {
    const queries = []
    let released = false
    const client = { async query(sql, args) {
      queries.push({ sql, args })
      if (sql.includes('SELECT * FROM repository_review_batch_files')) return { rows: [{ review_id: 'child', attempt_count: scenario.attempt || 1 }] }
      if (sql.includes('SELECT s.id FROM source_files')) return { rows: [{ id: 'valid' }] }
      return { rows: [] }
    }, release() { released = true } }
    const repo = createReviewBatchRepository({ async connect() { return client } })
    assert.equal(await repo.finish(workerFixture().job, scenario.output), true)
    const fileIndex = queries.findIndex((q) => q.sql.includes('SET status=$4::varchar(20)'))
    const update = queries[fileIndex]
    assert.equal(update.args[3], scenario.state)
    assert.ok(update.sql.includes("CASE WHEN $4::varchar(20)='Pending'"))
    assert.equal(queries[0].sql, 'BEGIN')
    assert.ok(queries.findIndex((q) => q.sql.startsWith('UPDATE repository_reviews SET')) < fileIndex)
    assert.equal(queries.at(-1).sql, 'COMMIT')
    assert.ok(!queries.some((q) => q.sql === 'ROLLBACK'))
    assert.equal(released, true)
    if (scenario.output.findings) assert.equal(queries.filter((q) => q.sql.includes('INSERT INTO repository_review_findings')).length, scenario.output.findings.length)
    if (scenario.output.code === 'ai_timeout') assert.equal(update.args[4], 'ai_timeout')
  }
})

test('SQL failure after child writes rolls back finalization without commit or aggregate update', async () => {
  const queries = []
  let released = false
  const client = { async query(sql) {
    queries.push(sql)
    if (sql.includes('SELECT * FROM repository_review_batch_files')) return { rows: [{ review_id: 'child', attempt_count: 1 }] }
    if (sql.includes('SELECT s.id FROM source_files')) return { rows: [{ id: 'valid' }] }
    if (sql.includes('SET status=$4::varchar(20)')) throw Object.assign(new Error('private SQL detail'), { code: '42P08' })
    return { rows: [] }
  }, release() { released = true } }
  const repo = createReviewBatchRepository({ async connect() { return client } })
  await assert.rejects(repo.finish(workerFixture().job, { findings: [] }), (e) => e.code === '42P08')
  assert.ok(queries.some((q) => q.includes("UPDATE repository_reviews SET status='Completed'")))
  assert.equal(queries.at(-1), 'ROLLBACK')
  assert.ok(!queries.includes('COMMIT'))
  assert.ok(!queries.some((q) => q.includes('UPDATE repository_review_batches b SET status=')))
  assert.equal(released, true)
})
test('Selected Files endpoint also accepts combined focus and preserves selected limits',async()=>{
 const f=await apiFixture(),body={projectId:'p',fileIds:f.files.slice(0,3).map(file=>file.id),options:{focus:'BugsAndSecurity'},idempotencyKey:'combined-selected'}
 const result=await post(f,body);assert.equal(result.status,202);assert.equal(result.body.batch.options.focus,'BugsAndSecurity');assert.equal(result.body.batch.coverage.submitted,3)
 assert.equal((await post(f,body)).body.batchId,result.body.batchId)
 assert.equal((await post(f,{...body,fileIds:f.files.map(file=>file.id)})).status,400)
})
