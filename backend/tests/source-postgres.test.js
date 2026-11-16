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

// Explicit opt-in TEST database only. Never connects to DATABASE_URL or reads .env.
test('PostgreSQL source survives pool recreation; conflict rolls back the entire upload', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async () => {
  const schema = `source_test_${crypto.randomBytes(8).toString('hex')}`
  const connectionString = process.env.SOURCE_TEST_DATABASE_URL
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
  let pool, reloaded
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    const options = { connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 }
    pool = new Pool(options)
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)')
    await pool.query(fs.readFileSync(path.join(__dirname, '../scripts/migrations/0132-source-workspace.sql'), 'utf8'))
    const ownerId = crypto.randomUUID(), otherId = crypto.randomUUID()
    await pool.query('INSERT INTO users(id) VALUES($1),($2)', [ownerId, otherId])
    const project = { id: 'persisted-project', name: 'Persistent source' }
    await createSourceRepository(pool).addFiles(project, ownerId, await extractSource(makeZip([{ path: 'src/app.ts', content: 'export const n: number = 1;' }])))
    await pool.end(); pool = null
    reloaded = new Pool(options)
    const repository = createSourceRepository(reloaded)
    const files = await repository.listFiles(project.id, ownerId)
    assert.equal(files.length, 1)
    assert.equal((await repository.readFile(project.id, files[0].id, ownerId)).content, 'export const n: number = 1;')
    assert.equal(await repository.findProject(project.id, otherId), null)
    assert.deepEqual(await repository.listFiles(project.id, otherId), [])
    // Sync updates existing paths by design. A file/directory collision remains
    // invalid and must roll back the unrelated new file in the same upload.
    await assert.rejects(repository.addFiles(project, ownerId, await extractSource(makeZip([{ path: 'new.js', content: 'safe' }, { path: 'src/app.ts/child.js', content: 'changed' }]))), (err) => err.code === 'path_conflict')
    assert.equal((await repository.listFiles(project.id, ownerId)).length, 1)
    await repository.removeProject(project.id)
    assert.deepEqual(await repository.listFiles(project.id, ownerId), [])
  } finally {
    if (pool) await pool.end()
    if (reloaded) await reloaded.end()
    // Only the random isolated schema created above is removed.
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.end()
  }
})
