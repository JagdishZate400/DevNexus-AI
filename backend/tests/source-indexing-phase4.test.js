require('./helpers/offline')
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const request = require('supertest')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const { makeZip } = require('./helpers/sourceZip')
const { createSourceIndexJobsRepository } = require('../src/db/sourceIndexJobsRepository')
const { createSourceIndexWorker } = require('../src/services/sourceIndexWorker')
const { generateRepositoryReply } = require('../src/services/repositoryChat')

const users = createTestRepository()
const owner = { id: crypto.randomUUID(), email: 'phase4-owner@example.com', role: 'Developer' }
const other = { id: crypto.randomUUID(), email: 'phase4-other@example.com', role: 'Developer' }
const ownerToken = signToken(owner)
const otherToken = signToken(other)

// In-memory mock repository implementing Phase 4 asynchronous indexing and job states
function createMockRepository() {
  const projects = new Map()
  const filesMap = new Map() // projId -> Map(pathLower -> file)
  const indexesMap = new Map() // fileId -> { source_sha256, index_version, status }
  const chunksMap = new Map() // fileId -> [chunks]
  const jobsMap = new Map() // projId -> [jobs]

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
      const pf = filesMap.get(id) || new Map()
      return [...pf.values()].map(({ content, ...meta }) => meta)
    },
    async readFile(id, fileId, uid) {
      const p = projects.get(id)
      if (!p || p.ownerId !== uid) return null
      const pf = filesMap.get(id) || new Map()
      for (const f of pf.values()) {
        if (f.id === fileId) return f
      }
      return null
    },
    async addFiles(project, uid, files, { syncMode = 'merge', confirmed = false, asyncIndexing = false, batchSize = 50 } = {}) {
      if (!projects.has(project.id)) {
        projects.set(project.id, { id: project.id, ownerId: uid, name: project.name })
      }
      if (!filesMap.has(project.id)) filesMap.set(project.id, new Map())
      const pf = filesMap.get(project.id)

      const addedFiles = []
      const updatedFiles = []
      const unchangedFiles = []

      for (const f of files) {
        const key = f.path.toLowerCase()
        const existing = pf.get(key)
        if (!existing) {
          const fileRecord = { ...f, id: crypto.randomUUID(), uploadedAt: new Date().toISOString() }
          pf.set(key, fileRecord)
          addedFiles.push(f.path)
        } else if (existing.sha256 === f.sha256) {
          unchangedFiles.push(f.path)
        } else {
          existing.content = f.content
          existing.sha256 = f.sha256
          existing.byteSize = f.byteSize
          updatedFiles.push(f.path)
        }
      }

      let indexing = null
      if (asyncIndexing) {
        const jobId = crypto.randomUUID()
        const job = {
          id: jobId,
          projectId: project.id,
          status: 'pending',
          totalFiles: pf.size,
          processedFiles: 0,
          indexedFiles: 0,
          excludedFiles: 0,
          pendingFiles: addedFiles.length + updatedFiles.length,
          failedFiles: 0,
          currentBatch: 0,
          totalBatches: Math.max(1, Math.ceil((addedFiles.length + updatedFiles.length) / batchSize)),
          batchSize,
          createdAt: new Date().toISOString(),
        }
        if (!jobsMap.has(project.id)) jobsMap.set(project.id, [])
        jobsMap.get(project.id).push(job)

        indexing = {
          jobId,
          status: 'pending',
          totalFiles: pf.size,
          pendingFiles: job.pendingFiles,
          indexedFiles: 0,
          excludedFiles: 0,
          chunkCount: 0,
          async: true,
        }
      } else {
        // Synchronous indexing
        for (const f of pf.values()) {
          indexesMap.set(f.id, { source_sha256: f.sha256, index_version: 1, status: 'indexed' })
          chunksMap.set(f.id, [{ ordinal: 0, content: f.content }])
        }
        indexing = {
          status: 'indexed',
          totalFiles: pf.size,
          indexedFiles: pf.size,
          excludedFiles: 0,
          pendingFiles: 0,
          chunkCount: pf.size,
        }
      }

      return {
        summary: {
          added: addedFiles.length,
          updated: updatedFiles.length,
          unchanged: unchangedFiles.length,
          missing: 0,
          removed: 0,
          preserved: 0,
          totalIncoming: files.length,
          resultingFiles: pf.size,
        },
        addedFiles,
        updatedFiles,
        unchangedFiles,
        indexing,
      }
    },
    async getIndexingStatus(projectId, uid) {
      const p = projects.get(projectId)
      if (!p || p.ownerId !== uid) {
        const err = new Error('Project not found.')
        err.code = 'not_found'
        err.status = 404
        throw err
      }
      const pf = filesMap.get(projectId) || new Map()
      const jobs = jobsMap.get(projectId) || []
      const latestJob = jobs[jobs.length - 1] || null

      let indexedCount = 0
      for (const f of pf.values()) {
        const idx = indexesMap.get(f.id)
        if (idx && idx.source_sha256 === f.sha256 && idx.status === 'indexed') indexedCount++
      }
      const pendingFiles = pf.size - indexedCount
      const status = latestJob ? latestJob.status : (pendingFiles === 0 ? 'completed' : 'pending')

      return {
        projectId,
        jobId: latestJob?.id || null,
        status,
        progress: {
          totalFiles: pf.size,
          processedFiles: indexedCount,
          indexedFiles: indexedCount,
          excludedFiles: 0,
          pendingFiles,
          failedFiles: latestJob?.failedFiles || 0,
          percent: pf.size === 0 ? 100 : Math.round((indexedCount / pf.size) * 100),
          currentBatch: latestJob?.currentBatch || 0,
          totalBatches: latestJob?.totalBatches || Math.max(1, Math.ceil(pf.size / 50)),
        },
        chunkCount: indexedCount,
        errorCode: null,
        errorMessage: null,
        createdAt: latestJob?.createdAt || null,
      }
    },
    async indexStats(projectId, uid) {
      const pf = filesMap.get(projectId) || new Map()
      let indexed = 0
      for (const f of pf.values()) {
        const idx = indexesMap.get(f.id)
        if (idx && idx.source_sha256 === f.sha256 && idx.status === 'indexed') indexed++
      }
      return {
        totalFiles: pf.size,
        indexedFiles: indexed,
        excludedFiles: 0,
        pendingFiles: pf.size - indexed,
        chunkCount: indexed,
      }
    },
    async searchSource(projectId, uid, query, limit) {
      const p = projects.get(projectId)
      if (!p || p.ownerId !== uid) return []
      const pf = filesMap.get(projectId) || new Map()
      const results = []
      for (const f of pf.values()) {
        const idx = indexesMap.get(f.id)
        if (idx && idx.source_sha256 === f.sha256 && f.content.includes(query)) {
          results.push({
            id: crypto.randomUUID(),
            fileId: f.id,
            path: f.path,
            startLine: 1,
            endLine: 2,
            startColumn: 1,
            endColumn: 10,
            snippet: f.content,
            rank: 0.8,
          })
        }
      }
      return results.slice(0, limit)
    },
    // Helper to simulate worker completing batches
    simulateWorkerBatch(projectId) {
      const jobs = jobsMap.get(projectId) || []
      const job = jobs[jobs.length - 1]
      if (!job) return
      const pf = filesMap.get(projectId) || new Map()
      for (const f of pf.values()) {
        indexesMap.set(f.id, { source_sha256: f.sha256, index_version: 1, status: 'indexed' })
        chunksMap.set(f.id, [{ ordinal: 0, content: f.content }])
      }
      job.status = 'completed'
      job.processedFiles = pf.size
      job.indexedFiles = pf.size
      job.pendingFiles = 0
    },
    simulateJobState(projectId, status, errorCode = null) {
      const jobs = jobsMap.get(projectId) || []
      const job = jobs[jobs.length - 1]
      if (job) {
        job.status = status
        if (errorCode) job.errorCode = errorCode
      }
    },
  }
}

let mockRepo, app, projectId
let mockWorkerTriggered = false
const mockWorker = {
  trigger() { mockWorkerTriggered = true },
}

before(async () => {
  await users.createUser(owner)
  await users.createUser(other)
  mockRepo = createMockRepository()
  app = createApp({ userRepository: users, sourceRepository: mockRepo, indexWorker: mockWorker })

  const created = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'Async Index Project', description: 'Phase 4 Testing' })
  projectId = created.body.project.id
})

function upload(zip, auth = ownerToken, id = projectId, query = '') {
  return request(app)
    .post(`/api/workspace/projects/${id}/upload${query}`)
    .set('Authorization', `Bearer ${auth}`)
    .set('Content-Type', 'application/zip')
    .send(zip)
}

test('Test 1: Asynchronous upload returns immediately with pending indexing status without blocking', async () => {
  mockWorkerTriggered = false
  const zip = makeZip([
    { path: 'src/main.rs', content: 'pub fn main() { println!("Async"); }' },
    { path: 'src/app.py', content: 'def run(): return "fast"' },
    { path: 'src/schema.sql', content: 'CREATE TABLE t (id INT);' },
  ])

  const res = await upload(zip, ownerToken, projectId, '?async=true')
  assert.equal(res.status, 201)
  assert.equal(res.body.uploadedFiles, 3)
  assert.equal(res.body.indexing.async, true)
  assert.equal(res.body.indexing.status, 'pending')
  assert.equal(res.body.indexing.totalFiles, 3)
  assert.equal(res.body.indexing.pendingFiles, 3)
  assert.ok(mockWorkerTriggered, 'Upload must trigger background worker')
})

test('Test 2: Authenticated indexing status API returns accurate batch progress', async () => {
  const res = await request(app)
    .get(`/api/workspace/projects/${projectId}/indexing/status`)
    .set('Authorization', `Bearer ${ownerToken}`)

  assert.equal(res.status, 200)
  assert.equal(res.body.projectId, projectId)
  assert.equal(res.body.status, 'pending')
  assert.equal(res.body.progress.totalFiles, 3)
  assert.equal(res.body.progress.pendingFiles, 3)
  assert.equal(res.body.progress.processedFiles, 0)
  assert.equal(res.body.progress.percent, 0)
})

test('Test 3: Cross-user authorization rejects unauthorized indexing status access with 404', async () => {
  const res = await request(app)
    .get(`/api/workspace/projects/${projectId}/indexing/status`)
    .set('Authorization', `Bearer ${otherToken}`)

  assert.equal(res.status, 404)
})

test('Test 4: Background worker batch completion updates indexing status to completed', async () => {
  mockRepo.simulateWorkerBatch(projectId)

  const res = await request(app)
    .get(`/api/workspace/projects/${projectId}/indexing/status`)
    .set('Authorization', `Bearer ${ownerToken}`)

  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'completed')
  assert.equal(res.body.progress.totalFiles, 3)
  assert.equal(res.body.progress.indexedFiles, 3)
  assert.equal(res.body.progress.pendingFiles, 0)
  assert.equal(res.body.progress.percent, 100)
  assert.equal(res.body.chunkCount, 3)
})

test('Test 5: Re-upload with identical content skips re-indexing', async () => {
  const zip = makeZip([
    { path: 'src/main.rs', content: 'pub fn main() { println!("Async"); }' },
    { path: 'src/app.py', content: 'def run(): return "fast"' },
    { path: 'src/schema.sql', content: 'CREATE TABLE t (id INT);' },
  ])

  const res = await upload(zip, ownerToken, projectId, '?async=true')
  assert.equal(res.status, 201)
  assert.equal(res.body.summary.unchanged, 3)
  assert.equal(res.body.indexing.pendingFiles, 0)
})

test('Test 6: Re-upload with modified file enqueues only modified delta for indexing', async () => {
  const zip = makeZip([
    { path: 'src/main.rs', content: 'pub fn main() { println!("Updated"); }' },
    { path: 'src/app.py', content: 'def run(): return "fast"' },
    { path: 'src/schema.sql', content: 'CREATE TABLE t (id INT);' },
  ])

  const res = await upload(zip, ownerToken, projectId, '?async=true')
  assert.equal(res.status, 201)
  assert.equal(res.body.summary.updated, 1)
  assert.equal(res.body.summary.unchanged, 2)
  assert.equal(res.body.indexing.pendingFiles, 1)
})

test('Test 7: Job state tracking supports pending, processing, completed, retrying, and failed', async () => {
  mockRepo.simulateJobState(projectId, 'processing')
  let res = await request(app).get(`/api/workspace/projects/${projectId}/indexing/status`).set('Authorization', `Bearer ${ownerToken}`)
  assert.equal(res.body.status, 'processing')

  mockRepo.simulateJobState(projectId, 'retrying')
  res = await request(app).get(`/api/workspace/projects/${projectId}/indexing/status`).set('Authorization', `Bearer ${ownerToken}`)
  assert.equal(res.body.status, 'retrying')

  mockRepo.simulateJobState(projectId, 'failed', 'timeout')
  res = await request(app).get(`/api/workspace/projects/${projectId}/indexing/status`).set('Authorization', `Bearer ${ownerToken}`)
  assert.equal(res.body.status, 'failed')

  mockRepo.simulateWorkerBatch(projectId)
  res = await request(app).get(`/api/workspace/projects/${projectId}/indexing/status`).set('Authorization', `Bearer ${ownerToken}`)
  assert.equal(res.body.status, 'completed')
})

test('Test 8: AI Chat incomplete-indexing guard notifies user rather than claiming source is missing', async () => {
  // Create project with pending unindexed files
  const p2Res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'Pending Chat Project', description: 'Testing Guard' })
  const p2Id = p2Res.body.project.id

  await upload(makeZip([{ path: 'src/service.go', content: 'package main' }]), ownerToken, p2Id, '?async=true')

  const chatReq = {
    app,
    user: { sub: owner.id, email: owner.email, role: owner.role },
  }

  const reply = await generateRepositoryReply(chatReq, {
    message: 'What does service.go do?',
    projectId: p2Id,
  })

  assert.equal(reply.grounded, false)
  assert.equal(reply.indexingInProgress, true)
  assert.ok(reply.reply.includes('currently being indexed'), 'Reply must inform user that indexing is in progress')
  assert.equal(reply.notice, 'Project indexing is still in progress.')
})

test('Test 9: Synchronous index fallback endpoint returns project indexing stats', async () => {
  const res = await request(app)
    .get(`/api/workspace/projects/${projectId}/index`)
    .set('Authorization', `Bearer ${ownerToken}`)

  assert.equal(res.status, 200)
  assert.equal(res.body.projectId, projectId)
  assert.ok(res.body.totalFiles >= 3)
  assert.ok(res.body.chunkCount >= 3)
  assert.ok(res.body.job, 'Response must include job metadata')
})
