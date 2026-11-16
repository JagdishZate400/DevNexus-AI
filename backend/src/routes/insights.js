const { Router } = require('express')
const { projects, tasks, sprints, members, documents } = require('../db/memory')
const { securityFindings } = require('../db/securityFindings')
const { authRequired } = require('../middleware/auth')
const { listActivity } = require('../services/activity')
const { asyncHandler } = require('../middleware/http')
const { reportsQuery } = require('../services/reporting')

const router = Router()
router.use(authRequired)

// Recent activity feed for dashboard / reports.
router.get('/activity', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50))
  return res.json({
    activity: listActivity({ type: req.query.type, projectId: req.query.projectId, limit }),
  })
})

// Dashboard compatibility: retain keys, scope counts to owned PostgreSQL projects.
router.get('/reports/summary', asyncHandler(async(req,res) => {
  res.set('Cache-Control','no-store')
  try { res.json(await reportsQuery(req,'summary',req.user.sub)) }
  catch(error) {
    if(error.code==='reports_unavailable')return res.status(503).json({code:error.code,message:error.message,requestId:req.requestId})
    throw error
  }
}))

// Single payload for the dashboard landing view.
router.get('/dashboard', (req, res) => {
  const openTasks = tasks.filter((t) => t.status !== 'Done').length
  const activeSprints = sprints.filter((s) => s.status === 'Active').length
  const criticalHigh = securityFindings.filter((f) => f.severity === 'Critical' || f.severity === 'High').length
  return res.json({
    stats: {
      projects: projects.length,
      openTasks,
      activeSprints,
      teamMembers: members.length,
      documents: documents.length,
      criticalHighFindings: criticalHigh,
    },
    recentActivity: listActivity({ limit: 10 }),
  })
})

module.exports = router
