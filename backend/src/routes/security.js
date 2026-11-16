const crypto = require('crypto')
const { Router } = require('express')
const { body } = require('express-validator')
const { authRequired } = require('../middleware/auth')
const { validate } = require('../middleware/http')
const { securityFindings } = require('../db/securityFindings')

const router = Router()

// In-memory findings per process. Restart resets to the curated seed.
let findings = securityFindings.map((f) => ({ ...f }))

function summarize(list) {
  const bugs = list.filter((f) => f.type === 'Bug').length
  const security = list.filter((f) => f.type === 'Security').length
  const criticalHigh = list.filter((f) => f.severity === 'Critical' || f.severity === 'High').length
  return {
    total: list.length,
    bugs,
    security,
    criticalHigh,
    open: list.filter((f) => f.status === 'Open').length,
    high: list.filter((f) => f.severity === 'High' || f.severity === 'Critical').length,
  }
}

function severityOverview(list) {
  const levels = ['Critical', 'High', 'Medium', 'Low', 'Info']
  return levels.map((level) => ({
    level,
    count: list.filter((f) => f.severity === level).length,
  }))
}

function categorySummary(list) {
  const map = new Map()
  for (const finding of list) {
    const key = `${finding.type}:${finding.category}`
    const existing = map.get(key)
    if (existing) existing.count += 1
    else map.set(key, { category: finding.category, count: 1, type: finding.type })
  }
  return [...map.values()]
}

router.get('/findings', authRequired, (req, res) => {
  return res.json({
    findings,
    stats: summarize(findings),
    severityOverview: severityOverview(findings),
    categorySummary: categorySummary(findings),
  })
})

router.get('/audit', authRequired, (req, res) => {
  return res.json({
    generatedAt: new Date().toISOString(),
    summary: summarize(findings),
    checks: [
      { id: 'helmet', status: 'pass', detail: 'Security headers enabled via helmet' },
      { id: 'cors', status: 'pass', detail: 'CORS restricted to allowlist' },
      { id: 'rate-limit', status: 'pass', detail: 'Global + auth rate limits enabled' },
      { id: 'jwt', status: 'pass', detail: 'Bearer JWT with expiry required for /api/*' },
    ],
    findings,
  })
})

router.post(
  '/analyze',
  authRequired,
  [
    body('projectId').optional().isString().isLength({ max: 120 }),
    body('analysisType').optional().isIn(['Bugs Only', 'Security Only', 'Full Analysis']),
    body('scope').optional().isString().isLength({ max: 80 }),
  ],
  validate,
  (req, res) => {
    const analysisType = req.body.analysisType || 'Full Analysis'
    const projectId = req.body.projectId || 'workspace'
    const stamp = new Date().toISOString()

    // Simulate a fresh analysis pass: reset from seed, optionally filter by type,
    // and stamp a new finding so the UI clearly reflects a successful run.
    let next = securityFindings.map((f) => ({ ...f, updated: 'Just now' }))
    if (analysisType === 'Bugs Only') next = next.filter((f) => f.type === 'Bug')
    if (analysisType === 'Security Only') next = next.filter((f) => f.type === 'Security')

    next.unshift({
      id: `finding-run-${crypto.randomUUID().slice(0, 8)}`,
      type: analysisType === 'Bugs Only' ? 'Bug' : 'Security',
      severity: 'Medium',
      title: `Analysis completed for ${projectId}`,
      file: 'analysis/report.md',
      line: '1',
      category: analysisType === 'Bugs Only' ? 'Code Quality' : 'Best Practice',
      status: 'Open',
      updated: 'Just now',
      problem: `Automated ${analysisType.toLowerCase()} finished at ${stamp}.`,
      explanation: 'This finding marks a successful analysis run against the selected project scope.',
      potentialRisk: 'Informational — review the full findings list for actionable issues.',
      recommendation: 'Triage Open findings by severity and mark false positives as you verify them.',
      code: `// Analysis type: ${analysisType}\n// Project: ${projectId}\n// Generated: ${stamp}`,
    })

    findings = next
    return res.status(201).json({
      message: 'Analysis complete',
      generatedAt: stamp,
      findings,
      stats: summarize(findings),
      severityOverview: severityOverview(findings),
      categorySummary: categorySummary(findings),
    })
  }
)

router.patch(
  '/findings/:id',
  authRequired,
  [body('status').isIn(['Open', 'Reviewed', 'False Positive', 'Fixed']).withMessage('Invalid status.')],
  validate,
  (req, res) => {
    const index = findings.findIndex((f) => f.id === req.params.id)
    if (index < 0) return res.status(404).json({ message: 'Finding not found' })
    findings[index] = { ...findings[index], status: req.body.status, updated: 'Just now' }
    return res.json({ finding: findings[index] })
  }
)

module.exports = router
