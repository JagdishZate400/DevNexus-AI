const { normalizeReviewOptions } = require('../services/reviewOptions')
const crypto = require('crypto')
const { Router } = require('express')
const { body, param, query } = require('express-validator')
const rateLimit = require('express-rate-limit')
const config = require('../config')
const { authRequired } = require('../middleware/auth')
const { asyncHandler, validate } = require('../middleware/http')
const { sourceQuery } = require('./workspace')
const { sourceError } = require('../services/sourceArchive')
const { validateReviewSource } = require('../services/reviewSource')
const { discoverProjectReview } = require('../services/reviewDiscovery')
const { REVIEW_SCOPE_VALUES, REVIEW_SCOPE_LIMITS, REVIEW_SCOPES, parseReviewScope } = require('../services/reviewScope')
const router = Router()
router.use(authRequired)
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
async function batchQuery(req, method, ...args) {
  try {
    const repo = req.app.locals.reviewBatchRepository || require('../db/reviewBatchRepository').createReviewBatchRepository(require('../db/postgres'))
    return await repo[method](...args)
  } catch (err) {
    if (['not_found', 'idempotency_conflict', 'review_queue_full', 'source_changed', 'review_discovery_limit', 'source_metadata_conflict', 'empty_source_project', 'invalid_request', 'invalid_review_scope'].includes(err.code)) throw err
    throw sourceError('review_storage_unavailable', 'Batch storage is unavailable. Check PostgreSQL and the D2.1/D2.2.1 migrations.', 503)
  }
}
router.get('/', asyncHandler(async (req, res) => res.json({ batches: await batchQuery(req, 'list', req.user.sub) })))
// Must precede /:id so "preview" is never interpreted as a batch UUID.
router.get('/preview', rateLimit({ windowMs: 60000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { code: 'review_preview_rate_limit', message: 'Too many project previews. Try again later.' },
}), [query('projectId').isString().bail().matches(/^[a-zA-Z0-9_-]{1,160}$/)], validate, asyncHandler(async (req, res) => {
  const preview = await discoverProjectReview({ projectId: req.query.projectId, ownerId: req.user.sub, repository: {
    findProject: (...args) => sourceQuery(req, 'findProject', ...args),
    discoverReviewFiles: (...args) => sourceQuery(req, 'discoverReviewFiles', ...args),
  } })
  res.json(preview)
}))
router.get('/:id', [param('id').isUUID(), query('findingOffset').optional().isString().bail().isInt({ min: 0, max: 4000 })], validate, asyncHandler(async (req, res) => {
  const batch = await batchQuery(req, 'read', req.params.id, req.user.sub, true, Number(req.query.findingOffset || 0))
  if (!batch) throw sourceError('not_found', 'Batch not found.', 404)
  res.json({ batch })
}))
router.post('/', rateLimit({ windowMs: 60000, max: 10, standardHeaders: true, legacyHeaders: false }), [
  body('projectId').isString().bail().matches(/^[a-zA-Z0-9_-]{1,160}$/),
  body('scope').optional().isString().bail().isIn(REVIEW_SCOPE_VALUES),
  body('fileIds').if((value, { req }) => req.body.scope !== REVIEW_SCOPES.project).isArray({ min: REVIEW_SCOPE_LIMITS[REVIEW_SCOPES.selected].minFiles, max: REVIEW_SCOPE_LIMITS[REVIEW_SCOPES.selected].maxFiles }),
  body('fileIds.*').if((value, { req }) => req.body.scope !== REVIEW_SCOPES.project).isUUID(),
  body('options').optional().isObject(), body('options.focus').optional().isIn(['General', 'Bugs', 'Security', 'Maintainability', 'BugsAndSecurity']),
  body('idempotencyKey').optional().isString().bail().matches(/^[a-zA-Z0-9_-]{1,100}$/),
], validate, asyncHandler(async (req, res) => {
  const scope = parseReviewScope(req.body.scope)
  const allowed = scope === REVIEW_SCOPES.project ? ['projectId', 'scope', 'options', 'idempotencyKey'] : ['projectId', 'fileIds', 'scope', 'options', 'idempotencyKey']
  if (Object.keys(req.body).some((k) => !allowed.includes(k))) throw sourceError('invalid_request', 'Submit only the fields supported by the selected review scope.')
  const options = normalizeReviewOptions(req.body.options)
  const ids = scope === REVIEW_SCOPES.selected ? req.body.fileIds.map((id) => id.toLowerCase()) : []
  if (new Set(ids).size !== ids.length) throw sourceError('duplicate_files', 'Select each file only once.')
  if (config.aiProvider !== 'gemini') throw sourceError('ai_configuration', 'Repository batches require the Gemini provider.', 503)
  const project = await sourceQuery(req, 'findProject', req.body.projectId, req.user.sub)
  if (!project) throw sourceError('not_found', 'Owned source project not found.', 404)
  const files = []
  for (const id of ids) {
    const file = await sourceQuery(req, 'readFile', project.id, id, req.user.sub)
    if (!file) throw sourceError('not_found', 'Every selected file must belong to this owned project.', 404)
    files.push({ ...file, ...validateReviewSource(file) })
  }
  const input = { projectId: project.id, scope, options, model: config.geminiModel, idempotencyKey: req.body.idempotencyKey || crypto.randomUUID() }
  if (scope === REVIEW_SCOPES.selected) input.files = files
  const batch = await batchQuery(req, 'enqueue', input, req.user.sub)
  res.status(202).json({ batchId: batch.id, batch })
}))
router.use((err, req, res, next) => {
  if (err.status && err.code) return res.status(err.status).json({ code: err.code, message: err.message, requestId: req.requestId })
  return next(err)
})
module.exports = router
