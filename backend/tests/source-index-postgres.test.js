require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
const { createSourceRepository } = require('../src/db/sourceRepository')
const { extractSource } = require('../src/services/sourceArchive')
const { makeZip } = require('./helpers/sourceZip')

test('real PostgreSQL full-text retrieval: backfill, auto-index, isolation, idempotence and restart persistence', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async () => {
  const schema = `index_test_${crypto.randomBytes(8).toString('hex')}`
  const connectionString = process.env.SOURCE_TEST_DATABASE_URL
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
  let pool, restarted
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    const options = { connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 }
    pool = new Pool(options)
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)')
    await pool.query(fs.readFileSync(path.join(__dirname, '../scripts/migrations/0132-source-workspace.sql'), 'utf8'))
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    await pool.query('INSERT INTO users(id) VALUES($1),($2)', [owner, other])
    const project = { id: 'existing-source', name: 'Existing source' }
    let repo = createSourceRepository(pool)
    await repo.addFiles(project, owner, await extractSource(makeZip([{ path: 'src/auth.ts', content: 'const start = 1;\r\nfunction authenticateUser() { return true; }' }])))
    await pool.query(fs.readFileSync(path.join(__dirname, '../scripts/migrations/0136-source-index.sql'), 'utf8'))
    assert.equal((await repo.indexStats(project.id, owner)).pendingFiles, 1)
    assert.equal((await repo.indexProject(project.id, owner)).indexedFiles, 1)
    const first = await repo.searchSource(project.id, owner, 'authenticateUser', 10)
    assert.equal(first.length, 1)
    assert.equal(first[0].path, 'src/auth.ts')
    assert.equal(first[0].startLine, 1); assert.equal(first[0].endLine, 2)
    assert.ok(first[0].snippet.includes('authenticateUser'))
    assert.equal((await repo.indexProject(project.id, owner)).processedFiles, 0)
    assert.deepEqual((await repo.searchSource(project.id, owner, 'authenticateUser', 10)).map((c) => c.id), first.map((c) => c.id))
    await repo.addFiles(project, owner, await extractSource(makeZip([{ path: 'src/cache.js', content: 'function invalidateCache() {}' }])))
    assert.equal((await repo.indexStats(project.id, owner)).indexedFiles, 2)
    assert.equal((await repo.searchSource(project.id, owner, 'invalidateCache', 10)).length, 1)
    const otherProject = { id: 'other-project', name: 'Other source' }
    await repo.addFiles(otherProject, other, await extractSource(makeZip([{ path: 'private.js', content: 'function confidentialOnly() {}' }])))
    assert.deepEqual(await repo.searchSource(project.id, other, 'authenticateUser', 10), [])
    assert.deepEqual(await repo.searchSource(project.id, owner, 'confidentialOnly', 10), [])
    await assert.rejects(repo.indexProject(otherProject.id, owner), (err) => err.code === 'not_found')
    assert.deepEqual(await repo.searchSource(project.id, owner, 'noSuchUniqueSymbol', 10), [])
    // Legacy unsupported/secret content must not enter the index even if stored manually.
    const bad = '-----BEGIN PRIVATE KEY-----'
    await pool.query('INSERT INTO source_files(id,project_id,path,language,content,byte_size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(), project.id, '.env', 'JavaScript', bad, Buffer.byteLength(bad), crypto.createHash('sha256').update(bad).digest('hex')])
    assert.equal((await repo.indexProject(project.id, owner)).excludedFiles, 1)
    assert.deepEqual(await repo.searchSource(project.id, owner, 'PRIVATE KEY', 10), [])
    await pool.end(); pool = null
    restarted = new Pool(options); repo = createSourceRepository(restarted)
    assert.equal((await repo.indexStats(project.id, owner)).chunkCount, 2)
    assert.equal((await repo.searchSource(project.id, owner, 'authenticateUser', 10))[0].path, 'src/auth.ts')
    await repo.removeProject(project.id)
    assert.equal((await restarted.query('SELECT count(*)::int AS n FROM source_chunks')).rows[0].n, 1)
  } finally {
    if (pool) await pool.end()
    if (restarted) await restarted.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.end()
  }
})
