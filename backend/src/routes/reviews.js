const crypto = require('crypto')
const { Router } = require('express')
const { body, param } = require('express-validator')
const { reviews } = require('../db/memory')
const { authRequired } = require('../middleware/auth')
const { validate, paginate, asyncHandler } = require('../middleware/http')
const { logActivity } = require('../services/activity')
const { hasLlm, generateReviewFindings } = require('../services/ai')
const { canManageShared } = require('../middleware/rbac')
const { analyzeSourceCode } = require('../services/codeReview')
const config = require('../config')
const { analyzeSource, aiError } = require('../services/gemini')

const router = Router()
router.use(authRequired)

const REVIEW_STATUSES = ['Queued', 'In Progress', 'Completed', 'Failed']
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info']

// Source is treated as text only, never executed or persisted. Gemini is optional.
router.post('/analyze', [
  body('code').isString().bail().isLength({ max: 50000 }).withMessage('Source code must be at most 50,000 characters.').bail()
    .custom((code) => code.trim().length > 0).withMessage('Source code is required.'),
  body('mode').optional().isIn(['gemini', 'deterministic']),
  body('language').isString().bail().isIn(['javascript', 'typescript']).withMessage('Supported languages: javascript, typescript.'),
  body('file').optional().isString().bail().isLength({ min: 1, max: 160 }),
], validate, asyncHandler(async (req, res) => {
  const { code, language } = req.body
  const file = req.body.file || (language === 'typescript' ? 'pasted-source.ts' : 'pasted-source.js')
  const provider = req.body.mode || (config.aiProvider === 'gemini' ? 'gemini' : 'deterministic')
  const allFindings = provider === 'gemini' ? await analyzeSource({ code, language, file }) : analyzeSourceCode(code, file)
  const findings = allFindings.slice(0, 200)
  const summary = Object.fromEntries(SEVERITIES.map((severity) => [severity, findings.filter((finding) => finding.severity === severity).length]))
  res.set('Cache-Control', 'no-store')
  return res.json({ provider, language, file, findings, summary, total: allFindings.length, truncated: allFindings.length > findings.length })
}))

// Deterministic mock review generator: stable output per (projectId+scope) so
// the UI demo is repeatable, while /api/security covers runtime scanning.
function generateFindings({ projectId, scope }) {
  const seed = `${projectId}:${scope}`
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 100000
  const templates = [
    {
      severity: 'High',
      file: 'backend/controllers/authController.js',
      line: '42',
      category: 'Potential Bug',
      status: 'Open',
      problem: 'Login input is used before full validation.',
      improvement: 'Validate email and password before executing authentication logic.',
      code: 'const { email, password } = req.body\nconst user = await User.authenticate(email, password)',
    },
    {
      severity: 'Medium',
      file: 'backend/controllers/productController.js',
      line: '78-92',
      category: 'Maintainability',
      status: 'Open',
      problem: 'Repeated response-building logic across branches.',
      improvement: 'Extract repeated response formatting into a reusable helper.',
      code: "return res.status(200).json({\n  data: product,\n  message: 'Product loaded'\n})",
    },
    {
      severity: 'Low',
      file: 'frontend/src/components/ProductCard.jsx',
      line: '31',
      category: 'Code Quality',
      status: 'Open',
      problem: 'Component contains multiple inline conditions.',
      improvement: 'Extract conditional rendering into small helper functions.',
      code: '{isAvailable ? (\n  <BuyButton />\n) : isLoading ? (\n  <Spinner />\n) : null}',
    },
    {
      severity: 'Info',
      file: 'backend/routes/productRoutes.js',
      line: '14',
      category: 'Best Practice',
      status: 'Open',
      problem: 'Route grouping could be more explicit.',
      improvement: 'Group product routes under a documented router prefix.',
      code: "router.get('/:productId', getProduct)",
    },
  ]
  const count = 2 + (hash % 3) // 2-4 findings
  return templates.slice(0, count).map((t, i) => ({
    id: `finding-${crypto.randomUUID().slice(0, 8)}`,
    ...t,
    severity: SEVERITIES[(hash + i) % SEVERITIES.length] === 'Critical' ? 'High' : t.severity,
  }))
}

router.get('/', (req, res) => {
  const list = [...reviews].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const { data, pagination } = paginate(list, req)
  return res.json({ reviews: data, pagination })
})

router.post(
  '/',
  [
    body('projectId').optional().isString().isLength({ max: 120 }),
    body('project').optional().isString().isLength({ max: 160 }),
    body('scope').optional().isString().isLength({ max: 200 }),
    body('focus').optional().isString().isLength({ max: 120 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    if (config.aiProvider === 'gemini') throw aiError('source_required', 'Use source code analysis and submit source code for Gemini review.', 400)
    const projectId = req.body.projectId || 'workspace'
    const project = req.body.project || projectId
    const scope = req.body.scope || 'Entire Project'
    const focus = req.body.focus || 'Code Quality'
    // Prefer the model when a key is configured; any failure degrades to the
    // deterministic local generator so the endpoint never 500s.
    let findings = null
    let provider = 'mock'
    if (hasLlm()) {
      try {
        findings = await generateReviewFindings({ project, projectId, scope, focus })
        provider = 'openrouter'
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[reviews] LLM findings failed (${err.message}) — using local generator`)
      }
    }
    if (!findings) findings = generateFindings({ projectId, scope })
    const review = {
      id: `review-${crypto.randomUUID().slice(0, 8)}`,
      project,
      projectId,
      scope,
      focus,
      provider,
      status: 'Completed',
      findings,
      findingsCount: findings.length,
      createdBy: req.user.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    reviews.unshift(review)
    logActivity({
      type: 'review',
      message: `Code review completed for ${project} (${findings.length} findings)`,
      actorEmail: req.user.email,
      projectId,
    })
    return res.status(201).json({ review })
  })
)

router.get('/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const review = reviews.find((r) => r.id === req.params.id)
  if (!review) return res.status(404).json({ message: 'Review not found', code: 'not_found' })
  return res.json({ review })
})

router.patch(
  '/:id',
  [param('id').trim().isLength({ min: 1, max: 80 }), body('status').isIn(REVIEW_STATUSES).withMessage('Invalid status.')],
  validate,
  (req, res) => {
    const review = reviews.find((r) => r.id === req.params.id)
    if (!review) return res.status(404).json({ message: 'Review not found', code: 'not_found' })
    if (!canMutateReview(req, review)) {
      return res.status(403).json({ message: 'Only the review creator or a lead can update this review', code: 'forbidden' })
    }
    review.status = req.body.status
    review.updatedAt = new Date().toISOString()
    return res.json({ review })
  }
)

router.delete('/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const index = reviews.findIndex((r) => r.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: 'Review not found', code: 'not_found' })
  if (!canMutateReview(req, reviews[index])) {
    return res.status(403).json({ message: 'Only the review creator or a lead can delete this review', code: 'forbidden' })
  }
  reviews.splice(index, 1)
  return res.status(204).end()
})

function canMutateReview(req, review) {
  if (canManageShared(req)) return true
  return String(review.createdBy || '').toLowerCase() === String(req.user.email || '').toLowerCase()
}

module.exports = router
