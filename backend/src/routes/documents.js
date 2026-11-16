const crypto = require('crypto')
const { Router } = require('express')
const { body, param } = require('express-validator')
const { documents } = require('../db/memory')
const { authRequired } = require('../middleware/auth')
const { validate, paginate, asyncHandler } = require('../middleware/http')
const { logActivity } = require('../services/activity')
const { hasLlm, generateDocumentContent } = require('../services/ai')
const { canManageShared } = require('../middleware/rbac')

const router = Router()
router.use(authRequired)

const DOC_TYPES = [
  'readme',
  'project-overview',
  'installation-guide',
  'architecture',
  'project-structure',
  'module-documentation',
  'api-documentation',
  'developer-notes',
  'technology-stack',
]
const DOC_STATUSES = ['Generated', 'Needs Update', 'Draft']

function buildContent({ type, project }) {
  const title = `${project} — ${type}`
  return `# ${title}\n\n> Generated locally by the backend documentation service.\n> Connect the FastAPI AI service (AI_SERVICE_URL) for LLM-authored docs.\n\n## Overview\n\nThis ${type} draft for **${project}** covers purpose, structure, and next steps.\n\n## Sections\n\n- Purpose and scope\n- Key components\n- Setup and usage\n- Open questions for review\n\n## Next steps\n\n1. Attach the repository file tree to enrich this draft.\n2. Re-run generation after wiring AI_SERVICE_URL for full RAG output.\n`
}

router.get('/types', (req, res) => res.json({ types: DOC_TYPES }))

router.get('/', (req, res) => {
  let list = [...documents].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const { type, projectId, search } = req.query
  if (type) list = list.filter((d) => d.type === type)
  if (projectId) list = list.filter((d) => d.projectId === projectId)
  if (search) {
    const q = String(search).toLowerCase()
    list = list.filter((d) => String(d.title).toLowerCase().includes(q) || String(d.content || '').toLowerCase().includes(q))
  }
  const { data, pagination } = paginate(list, req)
  return res.json({ documents: data, pagination })
})

router.post(
  '/generate',
  [
    body('projectId').optional().isString().isLength({ max: 120 }),
    body('project').optional().isString().isLength({ max: 160 }),
    body('type').isIn(DOC_TYPES).withMessage('Invalid document type.'),
    body('title').optional().isString().isLength({ max: 200 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const projectId = req.body.projectId || 'workspace'
    const project = req.body.project || projectId
    const { type } = req.body
    // Prefer the model when a key is configured; any failure degrades to the
    // local template so the endpoint never 500s.
    let content = null
    let provider = 'mock'
    if (hasLlm()) {
      try {
        content = await generateDocumentContent({ type, project, projectId })
        provider = 'openrouter'
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[documents] LLM generation failed (${err.message}) — using local template`)
      }
    }
    if (!content) content = buildContent({ type, project })
    const doc = {
      id: `doc-${crypto.randomUUID().slice(0, 8)}`,
      title: req.body.title || `${type} — ${project}`,
      type,
      project,
      projectId,
      provider,
      status: 'Generated',
      content,
      createdBy: req.user.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    documents.unshift(doc)
    logActivity({ type: 'docs', message: `Documentation generated: ${doc.title}`, actorEmail: req.user.email, projectId })
    return res.status(201).json({ document: doc })
  })
)

router.get('/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const doc = documents.find((d) => d.id === req.params.id)
  if (!doc) return res.status(404).json({ message: 'Document not found', code: 'not_found' })
  return res.json({ document: doc })
})

router.patch(
  '/:id',
  [
    param('id').trim().isLength({ min: 1, max: 80 }),
    body('title').optional().isString().isLength({ min: 1, max: 200 }),
    body('content').optional().isString().isLength({ max: 100000 }),
    body('status').optional().isIn(DOC_STATUSES).withMessage('Invalid status.'),
  ],
  validate,
  (req, res) => {
    const doc = documents.find((d) => d.id === req.params.id)
    if (!doc) return res.status(404).json({ message: 'Document not found', code: 'not_found' })
    if (!canMutateDoc(req, doc)) {
      return res.status(403).json({ message: 'Only the document creator or a lead can edit this document', code: 'forbidden' })
    }
    for (const key of ['title', 'content', 'status']) {
      if (req.body[key] !== undefined) doc[key] = req.body[key]
    }
    doc.updatedAt = new Date().toISOString()
    return res.json({ document: doc })
  }
)

router.delete('/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const index = documents.findIndex((d) => d.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: 'Document not found', code: 'not_found' })
  if (!canMutateDoc(req, documents[index])) {
    return res.status(403).json({ message: 'Only the document creator or a lead can delete this document', code: 'forbidden' })
  }
  documents.splice(index, 1)
  return res.status(204).end()
})

function canMutateDoc(req, doc) {
  if (canManageShared(req)) return true
  return String(doc.createdBy || '').toLowerCase() === String(req.user.email || '').toLowerCase()
}

module.exports = router
module.exports.DOC_TYPES = DOC_TYPES
