const crypto = require('crypto')
const { Router } = require('express')
const { body, param } = require('express-validator')
const { members } = require('../db/memory')
const { authRequired } = require('../middleware/auth')
const { requireRole } = require('../middleware/rbac')
const { validate, paginate, asyncHandler } = require('../middleware/http')
const { logActivity } = require('../services/activity')
const mailer = require('../services/mailer')

const router = Router()
router.use(authRequired)

const ROLES = ['Engineer', 'Designer', 'Product', 'QA', 'Lead']
const MEMBER_STATUSES = ['Active', 'Away', 'Invited']

router.get('/', (req, res) => {
  const { data, pagination } = paginate([...members], req)
  return res.json({ members: data, pagination })
})

// Membership changes are privilege-adjacent: leads only. The roster itself
// stays readable so any member can find collaborators.
const manageMembers = requireRole('Team Lead', 'Project Manager')

router.post(
  '/invite',
  manageMembers,
  [
    body('name').trim().isLength({ min: 1, max: 120 }).withMessage('Name is required.'),
    body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
    body('role').optional().isIn(ROLES).withMessage('Invalid role.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, email, role = 'Engineer' } = req.body
    const key = String(email).toLowerCase()
    if (members.some((m) => String(m.email).toLowerCase() === key)) {
      return res.status(409).json({ message: 'Member already invited', code: 'conflict' })
    }
    const member = {
      id: `member-${crypto.randomUUID().slice(0, 8)}`,
      name,
      email,
      role,
      projects: 0,
      status: 'Invited',
      invitedBy: req.user.email,
      createdAt: new Date().toISOString(),
    }
    members.unshift(member)
    logActivity({ type: 'team', message: `Member invited: ${name} (${email})`, actorEmail: req.user.email })
    // Fire-and-forget welcome email; invite succeeds even if SMTP is down.
    mailer.sendWelcomeEmail(email, name).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[team] failed to send welcome email to ${email}: ${err.message}`)
    })
    return res.status(201).json({ member })
  })
)

router.patch(
  '/:id',
  manageMembers,
  [
    param('id').trim().isLength({ min: 1, max: 80 }),
    body('name').optional().trim().isLength({ min: 1, max: 120 }),
    body('role').optional().isIn(ROLES).withMessage('Invalid role.'),
    body('status').optional().isIn(MEMBER_STATUSES).withMessage('Invalid status.'),
    body('projects').optional().isInt({ min: 0, max: 1000 }),
  ],
  validate,
  (req, res) => {
    const member = members.find((m) => m.id === req.params.id)
    if (!member) return res.status(404).json({ message: 'Member not found', code: 'not_found' })
    for (const key of ['name', 'role', 'status', 'projects']) {
      if (req.body[key] !== undefined) member[key] = req.body[key]
    }
    return res.json({ member })
  }
)

router.delete('/:id', manageMembers, [param('id').trim().isLength({ min: 1, max: 80 })], validate, (req, res) => {
  const index = members.findIndex((m) => m.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: 'Member not found', code: 'not_found' })
  const [removed] = members.splice(index, 1)
  logActivity({ type: 'team', message: `Member removed: ${removed.name}`, actorEmail: req.user.email })
  return res.status(204).end()
})

module.exports = router
module.exports.TEAM_ROLES = ROLES
