require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
const { createReviewBatchRepository } = require('../src/db/reviewBatchRepository')
const { createSourceRepository } = require('../src/db/sourceRepository')
const { createReviewRepository } = require('../src/db/reviewRepository')
const { createReviewBatchWorker } = require('../src/services/reviewBatchWorker')
const { validateReviewSource } = require('../src/services/reviewSource')

test('PostgreSQL batch manifests, leases, partial coverage, retries, findings and triage survive restart', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async () => {
  const connectionString = process.env.SOURCE_TEST_DATABASE_URL
  const schema = `batch_test_${crypto.randomBytes(8).toString('hex')}`
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
  let pool
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    const options = { connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 }
    pool = new Pool(options)
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)')
    for (const name of ['0132-source-workspace.sql', '0141-repository-reviews.sql', '0142-repository-review-batches.sql','0144-review-finding-type.sql']) await pool.query(fs.readFileSync(path.join(__dirname, '../scripts/migrations', name), 'utf8'))
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    await pool.query('INSERT INTO users VALUES($1),($2)', [owner, other])
    await pool.query("INSERT INTO source_projects(id,owner_id,name) VALUES('p',$1,'Project'),('other',$2,'Other')", [owner, other])
    const files = []
    for (const name of ['a.js', 'b.ts', 'c.js']) {
      const content = `export const value = '${name}';`, id = crypto.randomUUID(), sha256 = crypto.createHash('sha256').update(content).digest('hex')
      const file = { id, path: `src/${name}`, language: name.endsWith('.ts') ? 'TypeScript' : 'JavaScript', content, sha256 }
      await pool.query('INSERT INTO source_files(id,project_id,path,language,content,byte_size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, 'p', file.path, file.language, content, Buffer.byteLength(content), sha256])
      files.push({ ...file, ...validateReviewSource(file) })
    }
    let batches = createReviewBatchRepository(pool)
    const input = { projectId: 'p', files, options: { focus: 'General' }, model: 'test-model', idempotencyKey: 'first' }
    const batch = await batches.enqueue(input, owner)
    assert.equal((await batches.enqueue(input, owner)).id, batch.id)
    await assert.rejects(batches.enqueue({ ...input, files: [files[0]] }, owner), (e) => e.code === 'idempotency_conflict')
    assert.equal(await batches.read(batch.id, other), null)
    assert.deepEqual(await batches.list(other), [])
    const claims = await Promise.all([batches.claim(), createReviewBatchRepository(pool).claim()])
    assert.equal(claims.filter(Boolean).length, 1)
    const job = claims.find(Boolean)
    const child = await batches.attachReview(job)
    const finding = { id: `finding-${crypto.randomUUID()}`, severity: 'Low', category: 'Maintainability', line: '1', problem: 'p', explanation: 'e', improvement: 'i', code: files[0].content, suggestedCode: '' }
    assert.equal(await batches.finish(job, { findings: [finding], content: files[0].content }), true)
    assert.equal(await batches.finish(job, { findings: [finding] }), false)
    await pool.query("UPDATE repository_review_batch_files SET started_at=now()-interval '11 seconds'")
    const failed = await batches.claim()
    await batches.attachReview(failed)
    await batches.finish(failed, { code: 'ai_authentication' })
    await pool.query("UPDATE repository_review_batch_files SET started_at=now()-interval '11 seconds'")
    // Source mutation is confined to this random test schema, never application records.
    const changed = '// changed source'
    await pool.query('UPDATE source_files SET content=$2,byte_size=$3,sha256=$4 WHERE id=$1', [files[2].id, changed, Buffer.byteLength(changed), crypto.createHash('sha256').update(changed).digest('hex')])
    await createReviewBatchWorker({ batches, sources: createSourceRepository(pool), configuration: { aiProvider: 'gemini', geminiModel: 'test-model' }, analyze: async () => assert.fail('Changed source must not reach Gemini') }).runOnce()
    const partial = await batches.read(batch.id, owner)
    assert.equal(partial.status, 'Partial')
    assert.deepEqual(partial.coverage, { submitted: 3, pending: 0, running: 0, reviewed: 1, skipped: 1, failed: 1 })
    assert.equal(partial.findings[0].file, files[0].path)
    assert.equal(partial.findings[0].sourceHash, files[0].sourceHash)
    await createReviewRepository(pool).triage(child, finding.id, owner, 'Fixed')
    await pool.end(); pool = new Pool(options); batches = createReviewBatchRepository(pool)
    assert.equal((await batches.read(batch.id, owner)).findings[0].status, 'Fixed')
    assert.equal((await batches.list(owner))[0].status, 'Partial')

    await pool.query("UPDATE repository_review_batch_files SET started_at=now()-interval '11 seconds'")
    const recovery = await batches.enqueue({ ...input, files: [files[0]], idempotencyKey: 'recovery' }, owner)
    const expired = await batches.claim()
    const oldChild = await batches.attachReview(expired)
    await pool.query("UPDATE repository_review_batch_files SET lease_until=now()-interval '1 second',started_at=now()-interval '151 seconds' WHERE batch_id=$1", [recovery.id])
    await pool.end(); pool = new Pool(options); batches = createReviewBatchRepository(pool)
    assert.equal(await batches.claim(), null) // Recovered Pending, waits 60s before retry.
    assert.equal((await batches.read(recovery.id, owner)).files[0].status, 'Pending')
    assert.equal((await createReviewRepository(pool).read(oldChild, owner)).errorCode, 'worker_interrupted')
    await pool.query('UPDATE repository_review_batch_files SET available_at=now() WHERE batch_id=$1', [recovery.id])
    const resumed = await batches.claim()
    assert.equal(resumed.attempt, 2); assert.notEqual(resumed.token, expired.token)
    assert.equal(await batches.finish(expired, { findings: [] }), false)
    await batches.attachReview(resumed)
    await batches.finish(resumed, { findings: [], content: files[0].content })
    assert.equal((await batches.read(recovery.id, owner)).status, 'Completed')
    assert.equal((await batches.read(recovery.id, owner)).coverage.reviewed, 1)

    await pool.query("UPDATE repository_review_batch_files SET started_at=now()-interval '11 seconds'")
    const retryBatch = await batches.enqueue({ ...input, files: [files[0]], idempotencyKey: 'retry' }, owner)
    const first = await batches.claim(); await batches.attachReview(first)
    await batches.finish(first, { code: 'ai_timeout', retry: true })
    await pool.query("UPDATE repository_review_batch_files SET available_at=now(),started_at=now()-interval '11 seconds' WHERE batch_id=$1", [retryBatch.id])
    const last = await batches.claim(); await batches.attachReview(last)
    await batches.finish(last, { code: 'ai_timeout', retry: true })
    assert.equal((await batches.read(retryBatch.id, owner)).status, 'Failed')
    assert.equal((await batches.read(retryBatch.id, owner)).files[0].attempts, 2)
  } finally {
    if (pool) await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.end()
  }
})
