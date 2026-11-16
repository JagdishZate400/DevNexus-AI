require('./helpers/offline')
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const request = require('supertest')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { projects } = require('../src/db/memory')
const { signToken } = require('../src/middleware/auth')
const { extractSource, LIMITS } = require('../src/services/sourceArchive')
const { makeZip } = require('./helpers/sourceZip')
const users = createTestRepository()
const owner = { id: crypto.randomUUID(), email: 'source-owner@example.com', role: 'Developer' }
const other = { id: crypto.randomUUID(), email: 'source-other@example.com', role: 'Project Manager' }
// Explicit repository fixture; restart tests reuse stored state, never a runtime fallback.
const stored = new Map()
const repository = {
  async listProjects(id) { return [...stored.values()].filter((p) => p.ownerId === id).map(({ id, name }) => ({ id, name })) },
  async findProject(id, ownerId) { const p = stored.get(id); return p?.ownerId === ownerId ? { id, name: p.name } : null },
  async listFiles(id, ownerId) { return (stored.get(id)?.ownerId === ownerId ? stored.get(id).files : []).map(({ content, ...f }) => f) },
  async readFile(id, fileId, ownerId) { return stored.get(id)?.ownerId === ownerId ? stored.get(id).files.find((f) => f.id === fileId) : null },
  async addFiles(project, ownerId, files) {
    const p = stored.get(project.id) || { ...project, ownerId, files: [] }
    if (files.some((f) => p.files.some((old) => old.path === f.path))) throw Object.assign(new Error('Paths already exist.'), { code: 'path_conflict', status: 409 })
    p.files.push(...files.map((f) => ({ ...f, id: crypto.randomUUID(), uploadedAt: new Date().toISOString() })))
    stored.set(project.id, p)
  },
  async removeProject(id) { stored.delete(id) },
}
let app, token, otherToken, projectId
before(async () => {
  await users.createUser(owner); await users.createUser(other)
  token = signToken(owner); otherToken = signToken(other)
  app = createApp({ userRepository: users, sourceRepository: repository })
  const res = await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`).send({ name: 'Real source', description: 'Source upload fixture' })
  projectId = res.body.project.id
})
function upload(zip, auth = token, id = projectId) { return request(app).post(`/api/workspace/projects/${id}/upload`).set('Authorization', `Bearer ${auth}`).set('Content-Type', 'application/zip').send(zip) }

test('valid ZIP uploads real JS/TS content, returns metadata and persists across app recreation', async () => {
  const result = await upload(makeZip([{ path: 'src/a.js', content: 'export const x = 1;', deflate: true }, { path: 'src/b.ts', content: 'const n: number = 2;' }]))
  assert.equal(result.status, 201)
  assert.equal(result.body.uploadedFiles, 2)
  assert.equal(result.body.files[0].content, undefined)
  const fileId = result.body.files[0].id
  const reloaded = createApp({ userRepository: users, sourceRepository: repository })
  const index = projects.findIndex((p) => p.id === projectId)
  const [project] = projects.splice(index, 1)
  try {
    const res = await request(reloaded).get(`/api/workspace/projects/${projectId}/files/${fileId}`).set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.body.file.content, 'export const x = 1;')
    const list = await request(reloaded).get('/api/workspace/projects').set('Authorization', `Bearer ${token}`)
    assert.ok(list.body.projects.some((p) => p.id === projectId))
  } finally { projects.push(project) }
})

test('unauthenticated users and another project manager cannot upload, list, or read owner files', async () => {
  const zip = makeZip([{ path: 'other.js', content: 'const x = 0' }])
  assert.equal((await request(app).post(`/api/workspace/projects/${projectId}/upload`).set('Content-Type', 'application/zip').send(zip)).status, 401)
  assert.equal((await upload(zip, otherToken)).status, 404)
  assert.equal((await request(app).get(`/api/workspace/projects/${projectId}/files`).set('Authorization', `Bearer ${otherToken}`)).status, 404)
  const file = stored.get(projectId).files[0]
  assert.equal((await request(app).get(`/api/workspace/projects/${projectId}/files/${file.id}`).set('Authorization', `Bearer ${otherToken}`)).status, 404)
})

test('invalid uploads, MIME type and duplicate paths never produce fallback success', async () => {
  assert.equal((await upload(Buffer.from('not zip'))).status, 400)
  assert.equal((await request(app).post(`/api/workspace/projects/${projectId}/upload`).set('Authorization', `Bearer ${token}`).send({})).status, 415)
  assert.equal((await upload(makeZip([{ path: 'src/a.js', content: 'changed' }]))).status, 409)
  assert.equal(stored.get(projectId).files[0].content, 'export const x = 1;')
})

test('reject traversal, absolute paths, symlinks, secrets, and binary files atomically', async () => {
  const entries = [
    { path: '../bad.js' }, { path: '/bad.js' }, { path: 'C:\\bad.js' }, { path: 'src/../bad.js' },
    { path: 'link.js', mode: 0xa1ff }, { path: '.env' }, { path: 'root/.env.local' }, { path: 'private.key' },
    { path: 'binary.js', content: Buffer.from([0, 1, 2]) },
    { path: 'secret.js', content: '-----BEGIN PRIVATE KEY-----' }, { path: 'encrypted.js', encrypted: true },
  ]
  for (const entry of entries) {
    await assert.rejects(extractSource(makeZip([{ path: 'valid.js', content: 'safe' }, entry])), (err) => err.status === 400)
  }
  await assert.rejects(extractSource(makeZip([{ path: 'a.js' }, { path: 'A.js' }])))
  await assert.rejects(extractSource(makeZip([{ path: 'a.js' }, { path: 'a.js/b.ts' }])))
  await assert.rejects(extractSource(makeZip([{ path: 'bad.js', content: Buffer.from([0xff]) }])))
})

test('skip dependency folders, build outputs, and benign files without rejecting valid sources', async () => {
  const result = await extractSource(makeZip([
    { path: 'valid.js', content: 'export const ok = 1;' },
    { path: 'README.md', content: '# Documentation' },
    { path: 'node_modules/pkg/index.js', content: 'module.exports = {}' },
    { path: '.git/config', content: '[core]' },
    { path: 'dist/bundle.js', content: 'var x = 1;' },
    { path: 'assets/logo.png', content: 'binary' },
  ]))
  assert.equal(result.length, 1)
  assert.equal(result[0].path, 'valid.js')
  assert.equal(result[0].content, 'export const ok = 1;')
})

test('compressed, uncompressed and file count limits are enforced', async () => {
  await assert.rejects(extractSource(Buffer.alloc(LIMITS.archiveBytes + 1)), (err) => err.status === 413)
  await assert.rejects(extractSource(makeZip([{ path: 'large.js', content: 'a'.repeat(LIMITS.fileBytes + 1), deflate: true }])), (err) => err.status === 413)
  await assert.rejects(extractSource(makeZip(Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ path: `f${i}.js`, content: '' })))), (err) => err.status === 413)
  await assert.rejects(extractSource(makeZip([{ path: 'many-lines.js', content: '\n'.repeat(LIMITS.lines) }])), (err) => err.status === 413)
  assert.equal((await upload(Buffer.alloc(LIMITS.archiveBytes + 1))).status, 413)
})

test('corrupt CRC, empty archive and file count exhaustion are rejected without source execution', async () => {
  await assert.rejects(extractSource(makeZip([])), (err) => err.code === 'empty_archive')
  const zip = makeZip([{ path: 'a.js', content: 'throw new Error("never execute source")' }])
  const safe = await extractSource(zip)
  assert.equal(safe[0].content, 'throw new Error("never execute source")')
  zip[30 + Buffer.byteLength('a.js')] ^= 1
  await assert.rejects(extractSource(zip), (err) => err.code === 'invalid_zip')
  await assert.rejects(extractSource(makeZip(Array.from({ length: LIMITS.entries + 1 }, (_, i) => ({ path: `dir${i}/`, mode: 0x41ed })))), (err) => err.status === 413)
})

test('source-bearing project deletion removes stored source', async () => {
  const created = await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`).send({ name: 'Delete source', description: 'Fixture' })
  const id = created.body.project.id
  const result = await upload(makeZip([{ path: 'delete.js', content: 'const x = 0;' }]), token, id)
  assert.equal(result.status, 201)
  assert.equal((await request(app).delete(`/api/projects/${id}`).set('Authorization', `Bearer ${token}`)).status, 204)
  assert.equal(stored.has(id), false)
})

test('storage errors are sanitized and do not select a local store', async () => {
  const broken = createApp({ userRepository: users, sourceRepository: { async listProjects() { throw new Error('private database credentials') } } })
  const result = await request(broken).get('/api/workspace/projects').set('Authorization', `Bearer ${token}`)
  assert.equal(result.status, 503)
  assert.equal(result.body.code, 'source_storage_unavailable')
  assert.ok(!JSON.stringify(result.body).includes('private'))
})
