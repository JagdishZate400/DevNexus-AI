const crypto = require('crypto')
const { Router } = require('express')
const { body, param } = require('express-validator')
const { sprints } = require('../db/memory')
const { authRequired } = require('../middleware/auth')
const { canManageShared } = require('../middleware/rbac')
const { validate, paginate } = require('../middleware/http')
const { logActivity } = require('../services/activity')

const router = Router()
router.use(authRequired)

const STATUSES = ['Planning', 'Active', 'Completed']

// Sprint planning is collaborative (any member can create), but mutating or
// closing a sprint you did not create requires a lead role.
function canManage(req, sprint) {
  if (canManageShared(req)) return true
  return String(sprint.createdBy || '').toLowerCase() === String(req.user.email || '').toLowerCase()
}

function forbid(res) {
  return res.status(403).json({ message: 'Only the sprint creator or a lead can manage this sprint', code: 'forbidden' })
}

router.get('/', (req, res) => {
  const list = [...sprints]
  const { data, pagination } = paginate(list, req)
  return res.json({ sprints: data, pagination })
})

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 1, max: 160 }).withMessage('Name is required.'),
    body('goal').optional().isString().isLength({ max: 1000 }),
    body('startDate').optional().isISO8601().withMessage('startDate must be a date.'),
    body('endDate').optional().isISO8601().withMessage('endDate must be a date.'),
    body('status').optional().isIn(STATUSES),
    body('progress').optional().isInt({ min: 0, max: 100 }),
  ],
  validate,
  (req, res) => {
    const { name, goal = '', startDate = null, endDate = null, status = 'Planning', progress = 0 } = req.body
    const sprint = {
      id: `sprint-${crypto.randomUUID().slice(0, 8)}`,
      name,
      goal,
      startDate,
      endDate,
      status,
      progress,
      createdBy: req.user.email,
      createdAt: new Date().toISOString(),
    }
    sprints.unshift(sprint)
    logActivity({ type: 'sprint', message: `Sprint created: ${name}`, actorEmail: req.user.email })
    return res.status(201).json({ sprint })
  }
)

router.get('/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const sprint = sprints.find((s) => s.id === req.params.id)
  if (!sprint) return res.status(404).json({ message: 'Sprint not found', code: 'not_found' })
  return res.json({ sprint })
})

router.patch(
  '/:id',
  [
    param('id').trim().isLength({ min: 1, max: 80 }),
    body('name').optional().trim().isLength({ min: 1, max: 160 }),
    body('goal').optional().isString().isLength({ max: 1000 }),
    body('startDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('status').optional().isIn(STATUSES),
    body('progress').optional().isInt({ min: 0, max: 100 }),
  ],
  validate,
  (req, res) => {
    const sprint = sprints.find((s) => s.id === req.params.id)
    if (!sprint) return res.status(404).json({ message: 'Sprint not found', code: 'not_found' })
    if (!canManage(req, sprint)) return forbid(res)
    for (const key of ['name', 'goal', 'startDate', 'endDate', 'status', 'progress']) {
      if (req.body[key] !== undefined) sprint[key] = req.body[key]
    }
    return res.json({ sprint })
  }
)

// Only one Active sprint at a time: activating demotes the previous one.
router.post('/:id/activate', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const sprint = sprints.find((s) => s.id === req.params.id)
  if (!sprint) return res.status(404).json({ message: 'Sprint not found', code: 'not_found' })
  if (!canManage(req, sprint)) return forbid(res)
  for (const s of sprints) if (s.status === 'Active') s.status = 'Planning'
  sprint.status = 'Active'
  logActivity({ type: 'sprint', message: `Sprint activated: ${sprint.name}`, actorEmail: req.user.email })
  return res.json({ sprint })
})

router.post('/:id/complete', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const sprint = sprints.find((s) => s.id === req.params.id)
  if (!sprint) return res.status(404).json({ message: 'Sprint not found', code: 'not_found' })
  if (!canManage(req, sprint)) return forbid(res)
  sprint.status = 'Completed'
  sprint.progress = 100
  logActivity({ type: 'sprint', message: `Sprint completed: ${sprint.name}`, actorEmail: req.user.email })
  return res.json({ sprint })
})

router.delete('/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const index = sprints.findIndex((s) => s.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: 'Sprint not found', code: 'not_found' })
  if (!canManage(req, sprints[index])) return forbid(res)
  const [removed] = sprints.splice(index, 1)
  logActivity({ type: 'sprint', message: `Sprint deleted: ${removed.name}`, actorEmail: req.user.email })
  return res.status(204).end()
})

module.exports = router
