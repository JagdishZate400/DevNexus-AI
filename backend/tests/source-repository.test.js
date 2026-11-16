require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createSourceRepository } = require('../src/db/sourceRepository')
const { LIMITS } = require('../src/services/sourceArchive')

test('source repository locks ownership, uses parameterized SQL, commits complete text and releases connection', async () => {
  const calls = []
  const client = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.startsWith('SELECT owner_id')) return { rows: [{ owner_id: 'owner' }] }
      return { rows: [] }
    },
    release() { calls.push({ sql: 'release' }) },
  }
  const repository = createSourceRepository({ async connect() { return client } })
  const source = { path: 'src/app.js', language: 'JavaScript', content: 'throw new Error("never execute")', byteSize: 32, sha256: 'a'.repeat(64) }
  await repository.addFiles({ id: 'project', name: 'Project' }, 'owner', [source])
  assert.ok(calls.some((c) => c.sql.endsWith('FOR UPDATE')))
  const inserted = calls.find((c) => c.sql.startsWith('INSERT INTO source_files'))
  assert.equal(inserted.params[4], source.content)
  assert.ok(!inserted.sql.includes(source.content))
  assert.equal(calls.at(-2).sql, 'COMMIT')
  assert.equal(calls.at(-1).sql, 'release')
})

test('repository rolls back wrong ownership, existing paths and total project limits', async () => {
  for (const [owner, existing, incoming, expected] of [
    ['other', [], [{ path: 'a.js', byteSize: 1 }], 'not_found'],
    ['owner', [{ path: 'a.js', byte_size: 1 }], [{ path: 'a.js/sub.ts', byteSize: 1 }], 'path_conflict'],
    ['owner', [{ path: 'other.ts', byte_size: LIMITS.totalBytes }], [{ path: 'a.js', byteSize: 1 }], 'project_limit'],
  ]) {
    const calls = []
    const client = {
      async query(sql) { calls.push(sql); return { rows: sql.startsWith('SELECT owner_id') ? [{ owner_id: owner }] : sql.startsWith('SELECT id') || sql.startsWith('SELECT path') ? existing : [] } },
      release() { calls.push('release') },
    }
    const repository = createSourceRepository({ async connect() { return client } })
    await assert.rejects(repository.addFiles({ id: 'project', name: 'P' }, 'owner', incoming), (err) => err.code === expected)
    assert.equal(calls.at(-2), 'ROLLBACK')
    assert.equal(calls.at(-1), 'release')
    assert.ok(!calls.some((sql) => sql.startsWith('INSERT INTO source_files')))
  }
})
