require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const request = require('supertest')
const { chunkFile, MAX_CHUNK_BYTES } = require('../src/services/sourceChunks')
const { indexMethods, indexOnClient } = require('../src/db/sourceIndex')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
function source(content, path = 'src/auth.ts') {
  return { id: crypto.randomUUID(), path, language: 'TypeScript', content, sha256: crypto.createHash('sha256').update(content).digest('hex') }
}

test('chunks preserve exact CRLF/CR line ranges, long Unicode lines and empty-file semantics', () => {
  const text = Array.from({ length: 161 }, (_, i) => `const line${i + 1} = ${i};`).join('\r\n')
  const chunks = chunkFile(source(text))
  assert.deepEqual(chunks.map((c) => [c.startLine, c.endLine]), [[1, 80], [81, 160], [161, 161]])
  assert.equal(chunks.map((c) => c.content).join('\n'), text.replace(/\r\n/g, '\n'))
  const long = '😀'.repeat(5000)
  const split = chunkFile(source(long))
  assert.equal(split.map((c) => c.content).join(''), long)
  assert.equal(split[1].startColumn, 2001)
  assert.ok(split.every((c) => Buffer.byteLength(c.content) <= MAX_CHUNK_BYTES && c.startLine === 1 && c.endLine === 1))
  assert.deepEqual(chunkFile(source('')), [])
  assert.equal(chunkFile(source('a\rb\rc'))[0].endLine, 3)
})

test('unsupported paths, sensitive content and integrity mismatches never become chunks', () => {
  for (const file of [source('safe', '.env'), source('safe', 'a.unsupported'), source('-----BEGIN PRIVATE KEY-----'), { ...source('safe'), sha256: '0'.repeat(64) }]) {
    assert.throws(() => chunkFile(file))
  }
})

test('index uses version/hash idempotence, excludes unsafe source, and replaces chunks with parameterized SQL', async () => {
  const first = source('function authenticateUser() {}')
  const secret = source('-----BEGIN PRIVATE KEY-----', 'secret.js')
  const calls = []
  let done = false
  const client = { async query(sql, values) {
    calls.push({ sql, values })
    if (sql.startsWith('SELECT f.id')) return { rows: done ? [{ ...first, source_sha256: first.sha256, index_version: 1 }, { ...secret, source_sha256: secret.sha256, index_version: 1 }] : [first, secret] }
    if (sql.startsWith('SELECT count')) return { rows: [{ totalFiles: 2, indexedFiles: 1, excludedFiles: 1, chunkCount: 1 }] }
    return { rows: [] }
  } }
  assert.equal((await indexOnClient(client, 'project', 'owner')).excludedFiles, 1)
  const insert = calls.find((c) => c.sql.startsWith('INSERT INTO source_chunks'))
  assert.equal(JSON.parse(insert.values[1])[0].content, first.content)
  assert.ok(!JSON.stringify(calls).includes('PRIVATE KEY'))
  done = true; calls.length = 0
  assert.equal((await indexOnClient(client, 'project', 'owner')).processedFiles, 0)
  assert.ok(!calls.some((c) => c.sql.startsWith('INSERT') || c.sql.startsWith('DELETE')))
})

test('full-text retrieval binds owner and project, returns real snippets and permits empty results', async () => {
  const calls = []
  const pool = { async query(options) {
    calls.push(options)
    return { rows: options.values[2] === 'missing' ? [] : [{ path: 'src/auth.ts', startLine: 1, endLine: 2, snippet: 'function authenticateUser() {}' }] }
  } }
  const repo = indexMethods(pool)
  assert.equal((await repo.searchSource('project', 'owner', 'authenticateUser', 10))[0].path, 'src/auth.ts')
  assert.deepEqual(await repo.searchSource('project', 'owner', 'missing', 10), [])
  assert.deepEqual(calls[0].values, ['project', 'owner', 'authenticateUser', 10, 1])
  assert.ok(calls[0].text.includes('p.owner_id=$2'))
  assert.ok(calls[0].text.includes("plainto_tsquery('simple', $3)"))
})

test('search and indexing API require ownership even for managers; counts and empty matches are explicit', async () => {
  const users = createTestRepository()
  const owner = { id: crypto.randomUUID(), email: 'index-owner@example.com', role: 'Developer' }
  const other = { id: crypto.randomUUID(), email: 'index-other@example.com', role: 'Project Manager' }
  await users.createUser(owner); await users.createUser(other)
  const stats = { totalFiles: 1, indexedFiles: 1, excludedFiles: 0, pendingFiles: 0, chunkCount: 2 }
  const repo = {
    async findProject(id, uid) { return id === 'owned-index' && uid === owner.id ? { id, name: 'Owned' } : null },
    async indexProject(id, uid) { assert.equal(uid, owner.id); return { ...stats, processedFiles: 0 } },
    async indexStats() { return stats },
    async searchSource(id, uid, query) { assert.equal(uid, owner.id); return query === 'missing' ? [] : [{ path: 'src/auth.ts', startLine: 1, endLine: 2, snippet: 'function authenticateUser() {}' }] },
  }
  const app = createApp({ userRepository: users, sourceRepository: repo })
  const token = signToken(owner), otherToken = signToken(other)
  const base = '/api/workspace/projects/owned-index'
  assert.equal((await request(app).get(`${base}/search?q=auth`)).status, 401)
  for (const endpoint of ['/search?q=auth', '/index']) assert.equal((await request(app).get(base + endpoint).set('Authorization', `Bearer ${otherToken}`)).status, 404)
  assert.equal((await request(app).post(`${base}/index`).set('Authorization', `Bearer ${otherToken}`).send({})).status, 404)
  assert.equal((await request(app).get(`${base}/index`).set('Authorization', `Bearer ${token}`)).body.chunkCount, 2)
  assert.equal((await request(app).post(`${base}/index`).set('Authorization', `Bearer ${token}`).send({})).body.indexedFiles, 1)
  const empty = await request(app).get(`${base}/search?q=missing`).set('Authorization', `Bearer ${token}`)
  assert.equal(empty.status, 200); assert.deepEqual(empty.body.results, []); assert.equal(empty.body.returnedCount, 0)
  for (const query of ['', '?q=', '?q=x&limit=21', '?q=x&limit=1&limit=2', '?q=' + 'x'.repeat(201)]) assert.equal((await request(app).get(base + '/search' + query).set('Authorization', `Bearer ${token}`)).status, 400)
})
