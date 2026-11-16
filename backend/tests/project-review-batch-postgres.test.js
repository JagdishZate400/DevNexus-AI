require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { Pool } = require('pg')
const { createReviewBatchRepository } = require('../src/db/reviewBatchRepository')

// Separate already-migrated test DB only. Copies table definitions into an isolated schema;
// no migrations run, no development batches or source records are touched.
test('PostgreSQL entire-project atomic creation, idempotency, history and exclusions', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async () => {
  const connectionString = process.env.SOURCE_TEST_DATABASE_URL
  const schema = `project_batch_test_${crypto.randomBytes(8).toString('hex')}`
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 10000 })
  let pool
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    const tables = ['source_projects', 'source_files', 'repository_reviews', 'repository_review_findings', 'repository_review_batches', 'repository_review_batch_files']
    for (const table of tables) {
      const row = (await admin.query(`SELECT format('%I.%I',n.nspname,c.relname) AS qualified FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass($1)`, [table])).rows[0]
      assert.ok(row, 'Separate test DB must already have D1/D2.1/D2.2.1 tables.')
      await admin.query(`CREATE TABLE ${schema}.${table} (LIKE ${row.qualified} INCLUDING ALL)`)
    }
    pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000, query_timeout: 10000 })
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    await pool.query("INSERT INTO source_projects(id,owner_id,name) VALUES('p',$1,'Test'),('empty',$1,'Empty')", [owner])
    const files = []
    async function add(path, content = 'export const value=1;') {
      const file = { id: crypto.randomUUID(), path, content, hash: crypto.createHash('sha256').update(content).digest('hex') }
      await pool.query(`INSERT INTO source_files(id,project_id,path,language,content,byte_size,sha256) VALUES($1,'p',$2,'JavaScript',$3,$4,$5)`, [file.id, path, content, Buffer.byteLength(content), file.hash])
      files.push(file)
    }
    for (const path of ['z.js', 'a.js', 'b.js', 'c.js', 'skip.json']) await add(path)
    const repo = createReviewBatchRepository(pool)
    const input = { projectId: 'p', scope: 'Entire Project', options: { focus: 'General' }, model: 'test-model', idempotencyKey: 'project' }
    const [first, duplicate] = await Promise.all([repo.enqueue(input, owner), repo.enqueue(input, owner)])
    assert.equal(first.id, duplicate.id)
    assert.equal(first.coverage.pending, 4); assert.equal(first.coverage.skipped, 1)
    assert.deepEqual(first.files.map((f) => f.path), ['a.js', 'b.js', 'c.js', 'skip.json', 'z.js'])
    assert.equal(first.files.find((f) => f.path === 'skip.json').skipReason.code, 'unsupported_file')
    await add('later.js')
    assert.equal((await repo.enqueue(input, owner)).files.length, 5)
    assert.equal(await repo.read(first.id, other), null)
    await assert.rejects(repo.enqueue(input, other), (e) => e.status === 404)
    await assert.rejects(repo.enqueue({ ...input, options: { focus: 'Security' } }, owner), (e) => e.code === 'idempotency_conflict')
    await assert.rejects(repo.enqueue({ ...input, projectId: 'empty' }, owner), (e) => e.code === 'idempotency_conflict')
    await assert.rejects(repo.enqueue({ ...input, projectId: 'empty', idempotencyKey: 'empty' }, owner), (e) => e.code === 'empty_source_project')
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM repository_review_batches')).rows[0].count, 1)

    // Inject a constraint failure only into these copied test tables to check full rollback.
    await pool.query("ALTER TABLE repository_review_batch_files ADD CONSTRAINT test_manifest_failure CHECK(path<>'b.js') NOT VALID")
    await assert.rejects(repo.enqueue({ ...input, idempotencyKey: 'rollback' }, owner), (e) => e.code === '23514')
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM repository_review_batches')).rows[0].count, 1)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM repository_review_batch_files')).rows[0].count, 5)
    await pool.query('ALTER TABLE repository_review_batch_files DROP CONSTRAINT test_manifest_failure')
    const listing = await repo.list(owner)
    assert.equal(listing[0].scope, 'Entire Project'); assert.deepEqual(listing[0].files, [])
    assert.equal(listing[0].coverage.submitted, 5)

    // Test-only changes demonstrate the existing worker fencing and accurate source-change skip.
    const job = await repo.claim(), child = await repo.attachReview(job)
    const original = files.find((f) => f.id === job.file_id)
    assert.ok(child)
    const changed = 'export const changed=2;'
    await pool.query('UPDATE source_files SET content=$2,byte_size=$3,sha256=$4 WHERE id=$1', [original.id, changed, Buffer.byteLength(changed), crypto.createHash('sha256').update(changed).digest('hex')])
    assert.equal(await repo.finish(job, { findings: [], content: original.content }), true)
    const after = await repo.read(first.id, owner)
    assert.equal(after.files.find((f) => f.fileId === job.file_id).status, 'Skipped')
    assert.equal(after.files.find((f) => f.fileId === job.file_id).errorCode, 'source_changed_or_unavailable')
    assert.equal(after.coverage.reviewed, 0)
  } finally {
    if (pool) await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.end()
  }
})
