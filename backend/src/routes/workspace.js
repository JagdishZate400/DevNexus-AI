const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { authRequired } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/http')
const { query } = require('express-validator')
const { validate } = require('../middleware/http')
const { projects } = require('../db/memory')
const { extractSource, LIMITS, sourceError } = require('../services/sourceArchive')

const router = Router()
router.use(authRequired)
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

async function sourceQuery(req, method, ...args) {
  try {
    const repository = req.app.locals.sourceRepository || require('../db/sourceRepository').createSourceRepository(require('../db/postgres'))
    return await repository[method](...args)
  } catch (err) {
    if (err.status && ['not_found', 'project_limit', 'path_conflict', 'review_discovery_limit', 'confirmation_required'].includes(err.code)) throw err
    throw sourceError('source_storage_unavailable', 'Source storage is unavailable. Check PostgreSQL and apply the required source workspace/index migration.', 503)
  }
}

async function ownedProject(req) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(req.params.id)) throw sourceError('not_found', 'Project not found.', 404)
  // Memory project ownership is authoritative while it exists. No lead bypass.
  const project = projects.find((p) => p.id === req.params.id)
  if (project) {
    if (String(project.ownerEmail || project.owner || '').toLowerCase() !== req.user.email.toLowerCase()) throw sourceError('not_found', 'Project not found.', 404)
    return project
  }
  const stored = await sourceQuery(req, 'findProject', req.params.id, req.user.sub)
  if (!stored) throw sourceError('not_found', 'Project not found.', 404)
  return stored
}

async function safeUnlink(filePath) {
  if (!filePath) return
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      return
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        await new Promise((r) => setTimeout(r, 20))
      } else {
        return
      }
    }
  }
}

function streamUploadToTempFile(req, res, next) {
  const contentType = req.headers['content-type'] || ''
  if (!req.is('application/zip') && !contentType.includes('application/x-zip-compressed')) {
    return next(sourceError('zip_required', 'Upload a ZIP archive with Content-Type application/zip.', 415))
  }

  const contentLength = Number(req.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > LIMITS.archiveBytes) {
    req.resume()
    req.on('end', () => {
      next(sourceError('archive_limit', `ZIP archive exceeds ${Math.round(LIMITS.archiveBytes / (1024 * 1024))} MiB.`, 413))
    })
    return
  }

  const tempFilename = `devnexus-upload-${crypto.randomUUID()}.zip`
  const tempPath = path.join(os.tmpdir(), tempFilename)

  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    if (req.body.length > LIMITS.archiveBytes) {
      return next(sourceError('archive_limit', `ZIP archive exceeds ${Math.round(LIMITS.archiveBytes / (1024 * 1024))} MiB.`, 413))
    }
    fs.writeFile(tempPath, req.body, (err) => {
      if (err) return next(err)
      req.uploadTempPath = tempPath
      next()
    })
    return
  }

  const fileStream = fs.createWriteStream(tempPath, { flags: 'wx' })
  let receivedBytes = 0
  let aborted = false

  const cleanup = () => {
    try {
      fileStream.destroy()
    } catch {}
    safeUnlink(tempPath)
  }

  req.on('aborted', () => {
    aborted = true
    cleanup()
  })

  res.on('close', () => {
    if (!res.writableEnded) {
      aborted = true
      cleanup()
    }
  })

  req.on('data', (chunk) => {
    if (aborted) return
    receivedBytes += chunk.length
    if (receivedBytes > LIMITS.archiveBytes) {
      aborted = true
      req.unpipe(fileStream)
      fileStream.destroy()
      const finishOverflow = () => {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
        } catch {}
        req.resume()
        next(sourceError('archive_limit', `ZIP archive exceeds ${Math.round(LIMITS.archiveBytes / (1024 * 1024))} MiB.`, 413))
      }
      if (fileStream.closed) {
        setImmediate(finishOverflow)
      } else {
        fileStream.once('close', finishOverflow)
      }
      return
    }
  })

  fileStream.on('error', (err) => {
    if (aborted) return
    cleanup()
    next(err)
  })

  fileStream.on('finish', () => {
    if (aborted) return
    req.uploadTempPath = tempPath
    next()
  })

  req.pipe(fileStream)
}

router.get('/projects', asyncHandler(async (req, res) => {
  const stored = await sourceQuery(req, 'listProjects', req.user.sub)
  const owned = projects.filter((p) => String(p.ownerEmail || p.owner || '').toLowerCase() === req.user.email.toLowerCase()).map((p) => ({ id: p.id, name: p.name }))
  const combined = new Map(stored.map((p) => [p.id, p]))
  for (const project of owned) combined.set(project.id, project)
  return res.json({ projects: [...combined.values()] })
}))

router.get('/projects/:id/files', asyncHandler(async (req, res) => {
  const project = await ownedProject(req)
  const files = await sourceQuery(req, 'listFiles', project.id, req.user.sub)
  return res.json({ project: { id: project.id, name: project.name }, files })
}))

router.post('/projects/:id/index', rateLimit({ windowMs: 60000, max: 10, standardHeaders: true, legacyHeaders: false }), asyncHandler(async (req, res) => {
  const project = await ownedProject(req)
  return res.json({ projectId: project.id, ...(await sourceQuery(req, 'indexProject', project.id, req.user.sub)) })
}))

router.get('/projects/:id/index', asyncHandler(async (req, res) => {
  const project = await ownedProject(req)
  const stats = await sourceQuery(req, 'indexStats', project.id, req.user.sub)
  let job = null
  try {
    job = await sourceQuery(req, 'getIndexingStatus', project.id, req.user.sub)
  } catch {}
  return res.json({ projectId: project.id, ...stats, job })
}))

router.get('/projects/:id/indexing/status', asyncHandler(async (req, res) => {
  const project = await ownedProject(req)
  const status = await sourceQuery(req, 'getIndexingStatus', project.id, req.user.sub)
  return res.json(status)
}))

router.get('/projects/:id/search', [query('q').isString().bail().trim().isLength({ min: 1, max: 200 }), query('limit').optional().isString().bail().isInt({ min: 1, max: 20 })], validate, asyncHandler(async (req, res) => {
  const project = await ownedProject(req)
  const results = await sourceQuery(req, 'searchSource', project.id, req.user.sub, req.query.q.trim(), Number(req.query.limit || 10))
  return res.json({ projectId: project.id, results, returnedCount: results.length })
}))

router.get('/projects/:id/files/:fileId', asyncHandler(async (req, res) => {
  const project = await ownedProject(req)
  if (!/^[0-9a-f-]{36}$/i.test(req.params.fileId)) throw sourceError('not_found', 'Source file not found.', 404)
  const file = await sourceQuery(req, 'readFile', project.id, req.params.fileId, req.user.sub)
  if (!file) throw sourceError('not_found', 'Source file not found.', 404)
  return res.json({ file })
}))

router.post('/projects/:id/upload', rateLimit({ windowMs: 60000, max: 10, standardHeaders: true, legacyHeaders: false }),
  asyncHandler(async (req, res, next) => { req.sourceProject = await ownedProject(req); next() }),
  streamUploadToTempFile,
  asyncHandler(async (req, res) => {
    try {
      const files = await extractSource(req.uploadTempPath)
      const project = await ownedProject(req)
      const preview = req.query.preview === 'true'
      const syncMode = req.query.syncMode === 'delete_missing' ? 'delete_missing' : 'merge'
      const confirmed = req.query.confirmed === 'true'
      const asyncIndexing = req.query.async === 'true' || (req.query.syncWait !== 'true' && Boolean(req.app.locals.indexWorker))

      if (preview) {
        const previewResult = await sourceQuery(req, 'previewSync', project, req.user.sub, files, { syncMode })
        return res.status(200).json(previewResult)
      }

      const syncResult = await sourceQuery(req, 'addFiles', project, req.user.sub, files, { syncMode, confirmed, asyncIndexing })
      if (req.app.locals.indexWorker) {
        req.app.locals.indexWorker.trigger()
      }
      const projectFiles = await sourceQuery(req, 'listFiles', project.id, req.user.sub)

      return res.status(201).json({
        uploadedFiles: files.length,
        uploadedBytes: files.reduce((sum, f) => sum + f.byteSize, 0),
        summary: syncResult?.summary || {
          added: files.length,
          updated: 0,
          unchanged: 0,
          removed: 0,
          preserved: 0,
        },
        addedFiles: syncResult?.addedFiles || files.map((f) => f.path),
        updatedFiles: syncResult?.updatedFiles || [],
        unchangedFiles: syncResult?.unchangedFiles || [],
        removedFiles: syncResult?.removedFiles || [],
        preservedFiles: syncResult?.preservedFiles || [],
        indexing: syncResult?.indexing || null,
        files: projectFiles,
      })
    } finally {
      await safeUnlink(req.uploadTempPath)
    }
  }))

router.post('/projects/:id/sync/preview', rateLimit({ windowMs: 60000, max: 10, standardHeaders: true, legacyHeaders: false }),
  asyncHandler(async (req, res, next) => { req.sourceProject = await ownedProject(req); next() }),
  streamUploadToTempFile,
  asyncHandler(async (req, res) => {
    try {
      const files = await extractSource(req.uploadTempPath)
      const project = await ownedProject(req)
      const syncMode = req.query.syncMode === 'delete_missing' ? 'delete_missing' : 'merge'
      const previewResult = await sourceQuery(req, 'previewSync', project, req.user.sub, files, { syncMode })
      return res.status(200).json(previewResult)
    } finally {
      await safeUnlink(req.uploadTempPath)
    }
  }))

router.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.code === 'archive_limit') {
    return res.status(413).json({ code: 'archive_limit', message: `ZIP archive exceeds ${Math.round(LIMITS.archiveBytes / (1024 * 1024))} MiB.` })
  }
  if (err.status && err.code) return res.status(err.status).json({ code: err.code, message: err.message })
  if (err.type) return res.status(400).json({ code: 'invalid_upload', message: 'Invalid ZIP request.' })
  return next(err)
})

module.exports = { router, sourceQuery, ownedProject }
