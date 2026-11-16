const crypto = require('crypto')
const { Router } = require('express')
const { body, param, query } = require('express-validator')
const { tasks } = require('../db/memory')
const { authRequired } = require('../middleware/auth')
const { canManageShared } = require('../middleware/rbac')
const { validate, paginate, asyncHandler } = require('../middleware/http')
const { logActivity } = require('../services/activity')

const router = Router()
router.use(authRequired)

const STATUSES = ['Todo', 'In Progress', 'Done']
const PRIORITIES = ['Low', 'Medium', 'High']

function canMutate(req, task) {
  if (canManageShared(req)) return true
  const email = String(req.user.email || '').toLowerCase()
  return (
    String(task.createdBy || '').toLowerCase() === email ||
    String(task.assignee || '').toLowerCase() === email
  )
}

router.get(
  '/',
  [
    query('status').optional().isIn(STATUSES),
    query('priority').optional().isIn(PRIORITIES),
    query('project').optional().isString().isLength({ max: 120 }),
    query('assignee').optional().isString().isLength({ max: 120 }),
    query('search').optional().isString().isLength({ max: 120 }),
    query('sort').optional().isIn(['createdAt', 'priority', 'status']),
  ],
  validate,
  (req, res) => {
    let list = [...tasks].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    const { status, priority, project, assignee, search, sort } = req.query
    if (status) list = list.filter((t) => t.status === status)
    if (priority) list = list.filter((t) => t.priority === priority)
    if (project) list = list.filter((t) => String(t.project || '').toLowerCase() === String(project).toLowerCase())
    if (assignee) list = list.filter((t) => String(t.assignee || '').toLowerCase().includes(String(assignee).toLowerCase()))
    if (search) {
      const q = String(search).toLowerCase()
      list = list.filter(
        (t) => String(t.title).toLowerCase().includes(q) || String(t.description || '').toLowerCase().includes(q)
      )
    }
    if (sort === 'priority') {
      const order = { High: 0, Medium: 1, Low: 2 }
      list.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9))
    }
    const { data, pagination } = paginate(list, req)
    return res.json({ tasks: data, pagination })
  }
)

router.post(
  '/',
  [
    body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title is required.'),
    body('description').optional().isString().isLength({ max: 2000 }),
    body('status').optional().isIn(STATUSES).withMessage('Invalid status.'),
    body('priority').optional().isIn(PRIORITIES).withMessage('Invalid priority.'),
    body('assignee').optional().isString().isLength({ max: 120 }),
    body('project').optional().isString().isLength({ max: 120 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { title, description = '', status = 'Todo', priority = 'Medium', assignee = '', project = '' } = req.body
    const task = {
      id: `task-${crypto.randomUUID().slice(0, 8)}`,
      title,
      description,
      status,
      priority,
      assignee,
      project,
      createdBy: req.user.email,
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    }
    tasks.unshift(task)
    logActivity({ type: 'task', message: `Task created: ${title}`, actorEmail: req.user.email })
    return res.status(201).json({ task })
  })
)

router.get('/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id)
  if (!task) return res.status(404).json({ message: 'Task not found', code: 'not_found' })
  return res.json({ task })
})

router.patch(
  '/:id',
  [
    param('id').trim().isLength({ min: 1, max: 80 }),
    body('title').optional().trim().isLength({ min: 1, max: 200 }),
    body('description').optional().isString().isLength({ max: 2000 }),
    body('status').optional().isIn(STATUSES).withMessage('Invalid status.'),
    body('priority').optional().isIn(PRIORITIES).withMessage('Invalid priority.'),
    body('assignee').optional().isString().isLength({ max: 120 }),
    body('project').optional().isString().isLength({ max: 120 }),
  ],
  validate,
  (req, res) => {
    const task = tasks.find((t) => t.id === req.params.id)
    if (!task) return res.status(404).json({ message: 'Task not found', code: 'not_found' })
    if (!canMutate(req, task)) {
      return res.status(403).json({ message: 'Only the creator, assignee, or a lead can edit this task', code: 'forbidden' })
    }
    for (const key of ['title', 'description', 'status', 'priority', 'assignee', 'project']) {
      if (req.body[key] !== undefined) task[key] = req.body[key]
    }
    task.updatedAt = new Date().toISOString()
    logActivity({ type: 'task', message: `Task updated: ${task.title} → ${task.status}`, actorEmail: req.user.email })
    return res.json({ task })
  }
)

router.delete('/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const index = tasks.findIndex((t) => t.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: 'Task not found', code: 'not_found' })
  if (!canMutate(req, tasks[index])) {
    return res.status(403).json({ message: 'Only the creator, assignee, or a lead can delete this task', code: 'forbidden' })
  }
  const [removed] = tasks.splice(index, 1)
  logActivity({ type: 'task', message: `Task deleted: ${removed.title}`, actorEmail: req.user.email })
  return res.status(204).end()
})

module.exports = router
