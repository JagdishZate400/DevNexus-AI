require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const request = require('supertest')
const { discoverProjectReview } = require('../src/services/reviewDiscovery')
const { createSourceRepository } = require('../src/db/sourceRepository')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const ownerId = crypto.randomUUID()
const MiB = 1024 * 1024
function file(path = 'src/app.js', overrides = {}) {
  return { id: crypto.randomUUID(), path, language: 'JavaScript', byteSize: 20, characterCount: 20, lineCount: 1, sha256: 'a'.repeat(64), ...overrides }
}
function fixture(files, overrides = {}) {
  const calls = []
  const repository = {
    async findProject(id, uid) { calls.push(['owner', id, uid]); return id === 'p' && uid === ownerId ? { id, name: 'Project' } : null },
    async discoverReviewFiles(id, uid) { calls.push(['discovery', id, uid]); return { totalFiles: files.length, totalBytes: files.reduce((sum, f) => sum + f.byteSize, 0), files, ...overrides } },
    async readFile() { assert.fail('Preview must not load source text') },
    async listFiles() { assert.fail('Use the bounded snapshot, not unrestricted listing') },
  }
  return { calls, repository, preview: (uid = ownerId, projectId = 'p') => discoverProjectReview({ projectId, ownerId: uid, repository }) }
}
test('durable ownership precedes discovery, with no manager bypass or invalid project IDs', async () => {
  const f = fixture([file()])
  await assert.rejects(f.preview(crypto.randomUUID()), (e) => e.status === 404)
  assert.equal(f.calls.length, 1)
  await assert.rejects(f.preview(ownerId, '../p'), (e) => e.status === 400)
  await assert.rejects(f.preview(null), (e) => e.status === 401)
  assert.equal(f.calls.length, 1)
  await f.preview()
  assert.deepEqual(f.calls.at(-1), ['discovery', 'p', ownerId])
})
test('empty owned project has zero preliminary counts and no exclusions', async () => {
  const preview = await fixture([]).preview()
  assert.equal(preview.totalDiscoveredFiles, 0)
  assert.equal(preview.eligibleCandidateCount, 0)
  assert.equal(preview.knownSkippedFileCount, 0)
  assert.equal(preview.eligibilityIsPreliminary, true)
  assert.deepEqual(preview.files, [])
  assert.deepEqual(preview.skipReasons, [])
})
test('ordering is deterministic by NFC path then stable ID, regardless of metadata order', async () => {
  const files = [file('z.js'), file('é.js'), file('a.js')]
  const first = await fixture(files).preview(), second = await fixture([...files].reverse()).preview()
  assert.deepEqual(first, second)
  assert.deepEqual(first.files.map((f) => f.path), ['a.js', 'z.js', 'é.js'])
})
test('duplicate IDs and normalized/case-insensitive path collisions fail rather than double count', async () => {
  const a = file('a.js')
  for (const files of [[a, file('b.js', { id: a.id })], [a, file('A.js')], [file('é.js'), file('e\u0301.js')]]) await assert.rejects(fixture(files).preview(), (e) => e.code === 'source_metadata_conflict' && e.status === 409)
})
test('exactly 200 files pass; over-limit counts or listings fail with no partial preview', async () => {
  const files = Array.from({ length: 200 }, (_, i) => file(`src/${i}.js`))
  assert.equal((await fixture(files).preview()).eligibleCandidateCount, 200)
  await assert.rejects(fixture([...files, file('extra.js')]).preview(), (e) => e.status === 413)
  await assert.rejects(fixture(files, { totalFiles: 201 }).preview(), (e) => e.status === 413)
})
test('total uploaded size counts excluded files and permits exactly 10 MiB', async () => {
  const files = Array.from({ length: 20 }, (_, i) => file(`${i}.js`, { byteSize: 512 * 1024 }))
  assert.equal((await fixture(files).preview()).totalSourceBytes, 10 * MiB)
  files[0].byteSize++
  await assert.rejects(fixture(files).preview(), (e) => e.code === 'review_discovery_limit')
})
test('preview counters/reasons distinguish unsupported, oversized and unsafe metadata without returning source', async () => {
  const files = [file('ok.ts', { content: 'private source must not be returned', language: 'TypeScript' }),
    file('data.json'), file('bytes.js', { byteSize: 512 * 1024 + 1, characterCount: null, lineCount: null }),
    file('chars.js', { characterCount: 50001 }), file('lines.js', { lineCount: 10001 }),
    file('.env'), file('id_rsa.js'), file('bad.js', { sha256: 'invalid' })]
  const result = await fixture(files).preview()
  assert.equal(result.totalDiscoveredFiles, 8)
  assert.equal(result.eligibleCandidateCount, 1)
  assert.equal(result.knownSkippedFileCount, 7)
  assert.equal(result.skipReasons.reduce((sum, r) => sum + r.count, 0), 7)
  assert.deepEqual(new Set(result.skipReasons.map((r) => r.code)), new Set(['unsupported_file', 'source_bytes_limit', 'source_character_limit', 'source_line_limit', 'unsafe_path', 'sensitive_file', 'invalid_source_metadata']))
  assert.ok(!JSON.stringify(result).includes('private source'))
  assert.ok(result.files.every((f) => !('content' in f)))
  assert.equal(result.limits.review.characters, 50000)
  assert.equal(result.limits.review.bytes, 524288)
  assert.equal(result.limits.review.lines, 10000)
})
test('review limits are inclusive and changed/incomplete snapshots are rejected', async () => {
  assert.equal((await fixture([file('boundary.js', { characterCount: 50000, byteSize: 524288, lineCount: 10000 })]).preview()).eligibleCandidateCount, 1)
  assert.equal((await fixture([file('empty.js', { characterCount: 0, byteSize: 0, lineCount: 0 })]).preview()).eligibleCandidateCount, 1)
  await assert.rejects(fixture([file()], { totalFiles: 2 }).preview(), (e) => e.status === 409)
  await assert.rejects(fixture([file()], { totalBytes: 1 }).preview(), (e) => e.status === 409)
})
test('repository uses bounded scalar metrics in an owner-scoped repeatable-read snapshot', async () => {
  const calls = [], files = [file()], client = {
    async query(sql, args) {
      calls.push({ sql, args })
      if (sql.includes('count(f.id)')) return { rows: [{ id: 'p', name: 'Project', totalFiles: '1', totalBytes: '20' }] }
      return { rows: sql.includes('SELECT f.id') ? files : [] }
    }, release() { calls.push({ sql: 'released' }) },
  }
  const result = await createSourceRepository({ async connect() { return client } }).discoverReviewFiles('p', ownerId)
  assert.equal(result.files.length, 1)
  assert.equal(calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  const count = calls.find((c) => c.sql.includes('count(f.id)'))
  assert.equal(count.args[2], 201)
  assert.match(count.sql, /WHERE project_id=p.id LIMIT \$3/)
  const metrics = calls.find((c) => c.sql.includes('SELECT f.id'))
  assert.deepEqual(metrics.args.slice(0, 2), ['p', ownerId])
  assert.equal(metrics.args[4], 201)
  assert.match(metrics.sql, /WHERE p.id=\$1 AND p.owner_id=\$2/)
  assert.match(metrics.sql, /ORDER BY f.path COLLATE "C",f.id LIMIT \$5/)
  assert.match(metrics.sql, /AS "characterCount"/)
  assert.match(metrics.sql, /AS "lineCount"/)
  assert.doesNotMatch(metrics.sql, /SELECT\s+(?:\*|f\.\*)|(?:array_agg|jsonb_agg)\s*\(f\.content/i)
  assert.equal(calls.at(-2).sql, 'COMMIT')
  assert.equal(calls.at(-1).sql, 'released')
})
test('repository checks limits before metric calculation or content access and rolls back', async () => {
  for (const counts of [{ totalFiles: '201', totalBytes: '1' }, { totalFiles: '1', totalBytes: String(10 * MiB + 1) }]) {
    const calls = [], client = { async query(sql) { calls.push(sql); return { rows: sql.includes('count(f.id)') ? [{ id: 'p', ...counts }] : [] } }, release() {} }
    await assert.rejects(createSourceRepository({ async connect() { return client } }).discoverReviewFiles('p', ownerId), (e) => e.status === 413)
    assert.ok(!calls.some((sql) => sql.includes('SELECT f.id')))
    assert.equal(calls.at(-1), 'ROLLBACK')
  }
})
test('preview endpoint validates JWT/project ID, isolates managers, returns counters and sanitizes storage failures', async () => {
  const users = createTestRepository()
  const owner = { id: ownerId, email: 'preview-owner@example.com', role: 'Developer' }, other = { id: crypto.randomUUID(), email: 'preview-manager@example.com', role: 'Project Manager' }
  await users.createUser(owner); await users.createUser(other)
  const f = fixture([file(), file('skip.txt')])
  const app = createApp({ userRepository: users, sourceRepository: f.repository, reviewBatchRepository: { async enqueue() { assert.fail('Preview must never enqueue') } } })
  const path = '/api/repository-review-batches/preview?projectId=p'
  assert.equal((await request(app).get(path)).status, 401)
  assert.equal((await request(app).get(path).set('Authorization', `Bearer ${signToken(other)}`)).status, 404)
  const get = (url = path) => request(app).get(url).set('Authorization', `Bearer ${signToken(owner)}`)
  const result = await get()
  assert.equal(result.status, 200)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(result.body.eligibleCandidateCount, 1)
  assert.equal(result.body.knownSkippedFileCount, 1)
  for (const url of ['/api/repository-review-batches/preview', '/api/repository-review-batches/preview?projectId=../p', '/api/repository-review-batches/preview?projectId=p&projectId=p']) assert.equal((await get(url)).status, 400)
  f.repository.discoverReviewFiles = async () => { throw new Error('private database credential detail') }
  const failed = await get()
  assert.equal(failed.status, 503)
  assert.ok(!JSON.stringify(failed.body).includes('private'))
  f.repository.discoverReviewFiles = async () => { throw Object.assign(new Error('Project exceeds discovery limits.'), { code: 'review_discovery_limit', status: 413 }) }
  assert.equal((await get()).status, 413)
})
