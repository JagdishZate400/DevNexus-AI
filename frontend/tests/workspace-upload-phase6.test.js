import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatBytes,
  validateZipFile,
  workspaceApi,
} from '../src/services/api.js'

test('Phase 6: formatBytes converts byte counts into human-readable strings', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(-10), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1024), '1.0 KiB')
  assert.equal(formatBytes(512 * 1024), '512 KiB')
  assert.equal(formatBytes(1024 * 1024), '1.0 MiB')
  assert.equal(formatBytes(50 * 1024 * 1024), '50 MiB')
  assert.equal(formatBytes(52428800), '50 MiB')
})

test('Phase 6: validateZipFile enforces 50 MiB limit, extension check, and non-empty archive', () => {
  // Missing file
  const noFile = validateZipFile(null)
  assert.equal(noFile.valid, false)
  assert.match(noFile.error, /choose a ZIP archive/i)

  // Non-zip file extension
  const txtFile = { name: 'project.tar.gz', size: 1024, type: 'application/gzip' }
  const invalidExt = validateZipFile(txtFile)
  assert.equal(invalidExt.valid, false)
  assert.match(invalidExt.error, /only \.zip archives are supported/i)

  // Empty archive (0 bytes)
  const emptyFile = { name: 'empty.zip', size: 0, type: 'application/zip' }
  const emptyRes = validateZipFile(emptyFile)
  assert.equal(emptyRes.valid, false)
  assert.match(emptyRes.error, /empty \(0 bytes\)/i)

  // Oversized archive (> 50 MiB)
  const overFile = { name: 'huge.zip', size: 50 * 1024 * 1024 + 1, type: 'application/zip' }
  const overRes = validateZipFile(overFile)
  assert.equal(overRes.valid, false)
  assert.match(overRes.error, /exceeds the maximum allowed limit of 50 MiB/i)

  // Exactly 50 MiB (Valid boundary)
  const exactFile = { name: 'boundary.zip', size: 50 * 1024 * 1024, type: 'application/zip' }
  const exactRes = validateZipFile(exactFile)
  assert.equal(exactRes.valid, true)
  assert.equal(exactRes.error, undefined)

  // Typical valid ZIP archive
  const validFile = { name: 'fullstack-app.zip', size: 15 * 1024 * 1024, type: 'application/zip' }
  const validRes = validateZipFile(validFile)
  assert.equal(validRes.valid, true)
  assert.equal(validRes.error, undefined)
})

test('Phase 6: workspaceApi.upload sends query parameters for syncMode and confirmed', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      status: 201,
      json: async () => ({
        uploadedFiles: 10,
        uploadedBytes: 20480,
        summary: { added: 10, updated: 0, unchanged: 0, removed: 0, preserved: 0 },
      }),
    }
  }

  try {
    const file = { name: 'test.zip', size: 20480 }
    
    // 1. Default merge mode
    await workspaceApi.upload('test-token', 'proj-123', file)
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/workspace\/projects\/proj-123\/upload\?syncMode=merge&async=true/)
    assert.equal(calls[0].options.headers['Content-Type'], 'application/zip')
    assert.equal(calls[0].options.headers['Authorization'], 'Bearer test-token')

    // 2. Explicit delete_missing mode with confirmed flag
    await workspaceApi.upload('test-token', 'proj-123', file, { syncMode: 'delete_missing', confirmed: true })
    assert.equal(calls.length, 2)
    assert.match(calls[1].url, /syncMode=delete_missing&confirmed=true&async=true/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Phase 6: workspaceApi.previewSync calls preview endpoint with correct parameters', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        summary: { added: 3, updated: 2, unchanged: 5, removed: 0, preserved: 5, excluded: 1 },
        addedFiles: ['src/app.py', 'src/api.go', 'db/schema.sql'],
        updatedFiles: ['README.md', 'package.json'],
        unchangedFiles: ['LICENSE'],
        removedFiles: [],
        preservedFiles: ['LICENSE'],
        excludedFiles: ['node_modules/dep/index.js'],
        syncMode: 'merge',
        existingCount: 6,
        uploadCount: 10,
      }),
    }
  }

  try {
    const file = { name: 'update.zip', size: 10240 }
    const result = await workspaceApi.previewSync('test-token', 'proj-preview', file, 'merge')
    
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/workspace\/projects\/proj-preview\/sync\/preview\?syncMode=merge/)
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.headers['Content-Type'], 'application/zip')
    assert.equal(result.summary.added, 3)
    assert.equal(result.summary.updated, 2)
    assert.equal(result.summary.unchanged, 5)
    assert.equal(result.summary.excluded, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Phase 6: workspaceApi.indexingStatus and triggerIndex query asynchronous indexing jobs', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (options.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ projectId: 'proj-job', status: 'Queued', queuedFiles: 5 }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'job-uuid-1',
        projectId: 'proj-job',
        status: 'processing',
        progress: {
          totalFiles: 20,
          processedFiles: 10,
          indexedFiles: 10,
          failedFiles: 0,
          excludedFiles: 0,
          currentBatch: 1,
          totalBatches: 2,
          percentage: 50,
        },
      }),
    }
  }

  try {
    // 1. Fetch status
    const status = await workspaceApi.indexingStatus('test-token', 'proj-job')
    assert.equal(status.status, 'processing')
    assert.equal(status.progress.percentage, 50)
    assert.match(calls[0].url, /\/workspace\/projects\/proj-job\/indexing\/status/)

    // 2. Trigger re-index
    const triggered = await workspaceApi.triggerIndex('test-token', 'proj-job')
    assert.equal(triggered.status, 'Queued')
    assert.equal(calls[1].options.method, 'POST')
    assert.match(calls[1].url, /\/workspace\/projects\/proj-job\/index/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
