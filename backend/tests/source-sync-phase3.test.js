require('./helpers/offline')
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const request = require('supertest')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const { makeZip } = require('./helpers/sourceZip')
const { createSourceRepository } = require('../src/db/sourceRepository')

const users = createTestRepository()
const owner = { id: crypto.randomUUID(), email: 'sync-owner@example.com', role: 'Developer' }
const other = { id: crypto.randomUUID(), email: 'sync-other@example.com', role: 'Developer' }
const ownerToken = signToken(owner)
const otherToken = signToken(other)

// In-memory mock with full Phase 3 diff/sync semantics
function createMockRepository() {
  const projects = new Map()
  const filesMap = new Map() // projectId -> Map(pathLower -> fileObj)
  const reviews = new Map() // fileId -> reviewObj
  const conversations = new Map() // convId -> convObj

  return {
    async listProjects(uid) {
      return [...projects.values()].filter((p) => p.ownerId === uid).map(({ id, name }) => ({ id, name }))
    },
    async findProject(id, uid) {
      const p = projects.get(id)
      return p && p.ownerId === uid ? { id: p.id, name: p.name } : null
    },
    async listFiles(id, uid) {
      const p = projects.get(id)
      if (!p || p.ownerId !== uid) return []
      const projectFiles = filesMap.get(id) || new Map()
      return [...projectFiles.values()].map(({ content, ...meta }) => meta)
    },
    async readFile(id, fileId, uid) {
      const p = projects.get(id)
      if (!p || p.ownerId !== uid) return null
      const projectFiles = filesMap.get(id) || new Map()
      for (const f of projectFiles.values()) {
        if (f.id === fileId) return f
      }
      return null
    },
    async addFiles(project, uid, files, { syncMode = 'merge', confirmed = false } = {}) {
      if (!projects.has(project.id)) {
        projects.set(project.id, { id: project.id, ownerId: uid, name: project.name })
      }
      const p = projects.get(project.id)
      if (p.ownerId !== uid) {
        const err = new Error('Project not found.')
        err.code = 'not_found'
        err.status = 404
        throw err
      }

      if (!filesMap.has(project.id)) {
        filesMap.set(project.id, new Map())
      }
      const existingMap = filesMap.get(project.id)

      const isDeleteMissing = syncMode === 'delete_missing'
      if (isDeleteMissing && !confirmed) {
        const err = new Error('Deleting missing files requires explicit confirmation.')
        err.code = 'confirmation_required'
        err.status = 400
        throw err
      }

      const incomingMap = new Map()
      for (const f of files) {
        const key = f.path.toLowerCase()
        if (incomingMap.has(key)) {
          const err = new Error('Duplicate path.')
          err.code = 'duplicate_path'
          err.status = 400
          throw err
        }
        incomingMap.set(key, f)
      }

      const addedFiles = []
      const updatedFiles = []
      const unchangedFiles = []

      for (const f of files) {
        const key = f.path.toLowerCase()
        const existing = existingMap.get(key)
        if (!existing) {
          addedFiles.push(f)
        } else if (existing.sha256 === f.sha256) {
          unchangedFiles.push({ ...f, id: existing.id })
        } else {
          updatedFiles.push({ ...f, id: existing.id })
        }
      }

      const missingFiles = []
      for (const existing of existingMap.values()) {
        if (!incomingMap.has(existing.path.toLowerCase())) {
          missingFiles.push(existing)
        }
      }

      let removedFiles = []
      let preservedFiles = []

      if (isDeleteMissing && missingFiles.length > 0) {
        for (const m of missingFiles) {
          if (reviews.has(m.id)) {
            preservedFiles.push(m)
          } else {
            removedFiles.push(m)
          }
        }
      } else {
        preservedFiles = [...missingFiles]
      }

      // Apply changes
      for (const r of removedFiles) {
        existingMap.delete(r.path.toLowerCase())
      }
      for (const u of updatedFiles) {
        existingMap.set(u.path.toLowerCase(), {
          ...u,
          uploadedAt: new Date().toISOString(),
        })
      }
      for (const a of addedFiles) {
        const id = crypto.randomUUID()
        existingMap.set(a.path.toLowerCase(), {
          ...a,
          id,
          uploadedAt: new Date().toISOString(),
        })
      }

      const resultingCount = existingMap.size

      return {
        summary: {
          added: addedFiles.length,
          updated: updatedFiles.length,
          unchanged: unchangedFiles.length,
          removed: removedFiles.length,
          preserved: preservedFiles.length,
          totalIncoming: files.length,
          resultingFiles: resultingCount,
        },
        addedFiles: addedFiles.map((f) => f.path),
        updatedFiles: updatedFiles.map((f) => f.path),
        unchangedFiles: unchangedFiles.map((f) => f.path),
        removedFiles: removedFiles.map((f) => f.path),
        preservedFiles: preservedFiles.map((f) => f.path),
        indexing: {
          totalFiles: resultingCount,
          indexedFiles: resultingCount,
          excludedFiles: 0,
          chunkCount: resultingCount * 2,
          status: 'indexed',
        },
      }
    },
    async previewSync(project, uid, files, { syncMode = 'merge' } = {}) {
      const p = projects.get(project.id)
      if (!p || p.ownerId !== uid) {
        const err = new Error('Project not found.')
        err.code = 'not_found'
        err.status = 404
        throw err
      }

      const existingMap = filesMap.get(project.id) || new Map()
      const incomingMap = new Set(files.map((f) => f.path.toLowerCase()))

      const added = []
      const updated = []
      const unchanged = []

      for (const f of files) {
        const key = f.path.toLowerCase()
        const existing = existingMap.get(key)
        if (!existing) added.push(f.path)
        else if (existing.sha256 === f.sha256) unchanged.push(f.path)
        else updated.push(f.path)
      }

      const missing = []
      const protectedMissing = []
      const deletableMissing = []

      for (const existing of existingMap.values()) {
        if (!incomingMap.has(existing.path.toLowerCase())) {
          missing.push(existing.path)
          if (reviews.has(existing.id)) protectedMissing.push(existing.path)
          else deletableMissing.push(existing.path)
        }
      }

      const isDeleteMissing = syncMode === 'delete_missing'
      const resultingFiles = files.length + (isDeleteMissing ? protectedMissing.length : missing.length)

      return {
        projectId: project.id,
        syncMode,
        preview: true,
        added,
        updated,
        unchanged,
        missing,
        protectedMissing,
        deletableMissing,
        summary: {
          added: added.length,
          updated: updated.length,
          unchanged: unchanged.length,
          missing: missing.length,
          protected: protectedMissing.length,
          deletable: deletableMissing.length,
          totalIncoming: files.length,
          resultingFiles,
        },
      }
    },
    addReview(fileId) {
      reviews.set(fileId, { id: crypto.randomUUID(), fileId })
    },
    hasReview(fileId) {
      return reviews.has(fileId)
    },
  }
}

let mockRepo, app, projectId

before(async () => {
  await users.createUser(owner)
  await users.createUser(other)
  mockRepo = createMockRepository()
  app = createApp({ userRepository: users, sourceRepository: mockRepo })

  const created = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'Sync Test Project', description: 'Phase 3 Testing' })
  projectId = created.body.project.id
})

function upload(zip, auth = ownerToken, id = projectId, query = '') {
  return request(app)
    .post(`/api/workspace/projects/${id}/upload${query}`)
    .set('Authorization', `Bearer ${auth}`)
    .set('Content-Type', 'application/zip')
    .send(zip)
}

function preview(zip, auth = ownerToken, id = projectId, query = '') {
  return request(app)
    .post(`/api/workspace/projects/${id}/sync/preview${query}`)
    .set('Authorization', `Bearer ${auth}`)
    .set('Content-Type', 'application/zip')
    .send(zip)
}

test('Test 1: First upload of a new project adds all files and generates summary', async () => {
  const zip = makeZip([
    { path: 'src/app.js', content: 'export const app = 1;' },
    { path: 'src/utils.py', content: 'def util(): return 2' },
    { path: 'src/schema.sql', content: 'SELECT 3;' },
  ])

  const res = await upload(zip)
  assert.equal(res.status, 201)
  assert.equal(res.body.uploadedFiles, 3)
  assert.equal(res.body.summary.added, 3)
  assert.equal(res.body.summary.updated, 0)
  assert.equal(res.body.summary.unchanged, 0)
  assert.equal(res.body.summary.removed, 0)
  assert.equal(res.body.summary.preserved, 0)
  assert.equal(res.body.files.length, 3)
  assert.ok(res.body.indexing)
  assert.equal(res.body.indexing.indexedFiles, 3)
})

test('Test 2: Re-upload of an identical ZIP detects all unchanged files and skips rewrites', async () => {
  const zip = makeZip([
    { path: 'src/app.js', content: 'export const app = 1;' },
    { path: 'src/utils.py', content: 'def util(): return 2' },
    { path: 'src/schema.sql', content: 'SELECT 3;' },
  ])

  const originalFiles = await request(app)
    .get(`/api/workspace/projects/${projectId}/files`)
    .set('Authorization', `Bearer ${ownerToken}`)
  const originalIds = new Map(originalFiles.body.files.map((f) => [f.path, f.id]))

  const res = await upload(zip)
  assert.equal(res.status, 201)
  assert.equal(res.body.summary.added, 0)
  assert.equal(res.body.summary.updated, 0)
  assert.equal(res.body.summary.unchanged, 3)
  assert.equal(res.body.summary.removed, 0)
  assert.equal(res.body.files.length, 3)

  for (const f of res.body.files) {
    assert.equal(f.id, originalIds.get(f.path), `UUID for unchanged file ${f.path} must be preserved`)
  }
})

test('Test 3: Re-upload with modified files updates content and preserves existing UUIDs', async () => {
  const originalFiles = await request(app)
    .get(`/api/workspace/projects/${projectId}/files`)
    .set('Authorization', `Bearer ${ownerToken}`)
  const appFileIdBefore = originalFiles.body.files.find((f) => f.path === 'src/app.js').id

  const zip = makeZip([
    { path: 'src/app.js', content: 'export const app = 2; // modified' },
    { path: 'src/utils.py', content: 'def util(): return 2' }, // unchanged
    { path: 'src/schema.sql', content: 'SELECT 3;' }, // unchanged
  ])

  const res = await upload(zip)
  assert.equal(res.status, 201)
  assert.equal(res.body.summary.added, 0)
  assert.equal(res.body.summary.updated, 1)
  assert.equal(res.body.summary.unchanged, 2)
  assert.deepEqual(res.body.updatedFiles, ['src/app.js'])

  const fileAfter = await request(app)
    .get(`/api/workspace/projects/${projectId}/files/${appFileIdBefore}`)
    .set('Authorization', `Bearer ${ownerToken}`)
  assert.equal(fileAfter.status, 200)
  assert.equal(fileAfter.body.file.id, appFileIdBefore, 'UUID must remain identical')
  assert.equal(fileAfter.body.file.content, 'export const app = 2; // modified')
})

test('Test 4: Re-upload with new files inserts additions and preserves existing files', async () => {
  const zip = makeZip([
    { path: 'src/app.js', content: 'export const app = 2; // modified' },
    { path: 'src/utils.py', content: 'def util(): return 2' },
    { path: 'src/schema.sql', content: 'SELECT 3;' },
    { path: 'src/server.go', content: 'package main' }, // new
  ])

  const res = await upload(zip)
  assert.equal(res.status, 201)
  assert.equal(res.body.summary.added, 1)
  assert.equal(res.body.summary.updated, 0)
  assert.equal(res.body.summary.unchanged, 3)
  assert.deepEqual(res.body.addedFiles, ['src/server.go'])
  assert.equal(res.body.files.length, 4)
})

test('Test 5: Re-upload with missing files preserves existing files by default', async () => {
  // Upload only 1 file; 3 files are missing from this ZIP
  const zip = makeZip([
    { path: 'src/server.go', content: 'package main' },
  ])

  const res = await upload(zip)
  assert.equal(res.status, 201)
  assert.equal(res.body.summary.added, 0)
  assert.equal(res.body.summary.updated, 0)
  assert.equal(res.body.summary.unchanged, 1)
  assert.equal(res.body.summary.removed, 0)
  assert.equal(res.body.summary.preserved, 3)
  assert.equal(res.body.preservedFiles.length, 3)
  assert.equal(res.body.files.length, 4, 'All 4 files must remain preserved')
})

test('Test 6: Preview synchronization mode returns accurate diff without altering database', async () => {
  const zip = makeZip([
    { path: 'src/app.js', content: 'export const app = 3; // modified again' },
    { path: 'src/new.rs', content: 'fn main() {}' }, // added
  ])

  const res = await preview(zip)
  assert.equal(res.status, 200)
  assert.equal(res.body.preview, true)
  assert.deepEqual(res.body.added, ['src/new.rs'])
  assert.deepEqual(res.body.updated, ['src/app.js'])
  assert.equal(res.body.summary.added, 1)
  assert.equal(res.body.summary.updated, 1)
  assert.equal(res.body.missing.length, 3)

  // Verify database files were NOT modified by preview
  const currentFiles = await request(app)
    .get(`/api/workspace/projects/${projectId}/files`)
    .set('Authorization', `Bearer ${ownerToken}`)
  assert.equal(currentFiles.body.files.length, 4)
  assert.ok(!currentFiles.body.files.some((f) => f.path === 'src/new.rs'))
})

test('Test 7: Explicit synchronization requires confirmation before deleting missing files', async () => {
  const zip = makeZip([
    { path: 'src/server.go', content: 'package main' },
  ])

  // Without confirmed=true: must fail with confirmation_required
  const resUnconfirmed = await upload(zip, ownerToken, projectId, '?syncMode=delete_missing')
  assert.equal(resUnconfirmed.status, 400)
  assert.equal(resUnconfirmed.body.code, 'confirmation_required')

  // Project files must still be 4
  const filesStill4 = await request(app)
    .get(`/api/workspace/projects/${projectId}/files`)
    .set('Authorization', `Bearer ${ownerToken}`)
  assert.equal(filesStill4.body.files.length, 4)
})

test('Test 8: Historical review records protect missing files from deletion during sync', async () => {
  const currentFiles = await request(app)
    .get(`/api/workspace/projects/${projectId}/files`)
    .set('Authorization', `Bearer ${ownerToken}`)
  const appFile = currentFiles.body.files.find((f) => f.path === 'src/app.js')

  // Attach a historical review to src/app.js
  mockRepo.addReview(appFile.id)

  // Upload an archive containing only src/server.go with delete_missing & confirmed=true
  const zip = makeZip([
    { path: 'src/server.go', content: 'package main' },
  ])

  const res = await upload(zip, ownerToken, projectId, '?syncMode=delete_missing&confirmed=true')
  assert.equal(res.status, 201)
  assert.equal(res.body.summary.unchanged, 1) // src/server.go
  assert.ok(res.body.summary.removed >= 1) // src/utils.py, src/schema.sql removed

  // src/app.js must be PROTECTED because it has a historical review!
  assert.ok(res.body.preservedFiles.includes('src/app.js'), 'src/app.js must be preserved due to historical review')
  const afterFiles = await request(app)
    .get(`/api/workspace/projects/${projectId}/files`)
    .set('Authorization', `Bearer ${ownerToken}`)
  assert.ok(afterFiles.body.files.some((f) => f.path === 'src/app.js'), 'Protected file must still exist')
  assert.ok(!afterFiles.body.files.some((f) => f.path === 'src/utils.py'), 'Unreferenced file must be pruned')
})

test('Test 9: Cross-project isolation prevents unauthorized sync or preview', async () => {
  const zip = makeZip([{ path: 'src/evil.js', content: 'evil' }])

  const resUpload = await upload(zip, otherToken, projectId)
  assert.equal(resUpload.status, 404)

  const resPreview = await preview(zip, otherToken, projectId)
  assert.equal(resPreview.status, 404)
})

test('Test 10: Atomic rollback on failure rejects secrets without partial writes', async () => {
  const zip = makeZip([
    { path: 'src/new-safe.js', content: 'safe code' },
    { path: 'src/bad.key', content: '-----BEGIN PRIVATE KEY-----' },
  ])

  const res = await upload(zip)
  assert.equal(res.status, 400)

  const afterFiles = await request(app)
    .get(`/api/workspace/projects/${projectId}/files`)
    .set('Authorization', `Bearer ${ownerToken}`)
  assert.ok(!afterFiles.body.files.some((f) => f.path === 'src/new-safe.js'), 'No partial writes on failure')
})
