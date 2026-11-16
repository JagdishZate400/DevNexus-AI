const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { Router } = require('express')
const { body } = require('express-validator')
const config = require('../config')
const { emailVerifications, refreshTokens, consumedRefreshTokens, passwordResets } = require('../db/memory')
const { authRequired, signToken, verifyToken } = require('../middleware/auth')
const { requireRole } = require('../middleware/rbac')
const { validate, asyncHandler } = require('../middleware/http')
const { userQuery, isEmailConflict } = require('../services/userRepository')
const mailer = require('../services/mailer')
const { logSecurityEvent, detectSuspiciousActivity } = require('../services/securityLog')
const {
  issueRefreshToken,
  consumeRefreshToken,
  inspectRefreshToken,
  revokeRefreshToken,
  revokeUserRefreshTokens,
  listUserSessions,
  issuePasswordReset,
  consumePasswordReset,
} = require('../services/tokens')

const router = Router()
const ROLES = ['Developer', 'Team Lead', 'Project Manager']

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/
const passwordChecks = (field) => [
  body(field)
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters.')
    .matches(PASSWORD_RULE)
    .withMessage('Password must include an uppercase letter, a lowercase letter, a number, and a symbol.'),
]

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-defense', 10)
const loginAttempts = new Map()

function getAttempt(key) {
  const entry = loginAttempts.get(key)
  if (!entry) return { count: 0, lockedUntil: 0 }
  if (entry.lockedUntil === 0 || entry.lockedUntil > Date.now()) return entry
  loginAttempts.delete(key)
  return { count: 0, lockedUntil: 0 }
}

function lockoutResponse(res, lockedUntil) {
  const retryAfter = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000))
  res.set('Retry-After', String(retryAfter))
  return res.status(423).json({
    message: `Account locked after too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
    retryAfter,
  })
}

function publicUser(user) {
  return { id: user.id, name: user.fullName, email: user.email, role: user.role }
}

const CODE_TTL_MS = 10 * 60 * 1000
const VERIFIED_TTL_MS = 30 * 60 * 1000
const RESEND_COOLDOWN_MS = 30 * 1000
const MAX_VERIFY_ATTEMPTS = 5
const MAX_SENDS_PER_HOUR = 5
const SEND_WINDOW_MS = 60 * 60 * 1000

const CODE_PEPPER = crypto.randomBytes(32)

function generateCode() {
  return String(crypto.randomInt(100000, 1000000))
}

function hashCode(emailKey, code) {
  return crypto.createHmac('sha256', CODE_PEPPER).update(`${emailKey}:${code}`).digest()
}

function codeMatches(emailKey, submitted, expectedHex) {
  const actual = hashCode(emailKey, String(submitted).trim())
  const expected = Buffer.from(String(expectedHex || ''), 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function demoCodeMatches(submitted) {
  if (config.isProd) return false
  const expected = String(config.demoVerificationCode || '').trim()
  if (!expected) return false
  const a = Buffer.from(String(submitted).trim())
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function recentSends(entry) {
  const now = Date.now()
  return ((entry && entry.sendTimestamps) || []).filter((t) => now - t < SEND_WINDOW_MS)
}

function consumeVerifiedEmail(email) {
  const key = String(email || '').toLowerCase()
  const entry = emailVerifications.get(key)
  if (!entry || !entry.verified) return false
  if (Date.now() - entry.verifiedAt > VERIFIED_TTL_MS) {
    emailVerifications.delete(key)
    return false
  }
  return true
}

router.post(
  '/request-code',
  [body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail()],
  validate,
  asyncHandler(async (req, res) => {
    const email = req.body.email
    const key = String(email).toLowerCase()
    if (await userQuery(req, 'findByEmail', key)) {
      return res.json({
        message: `Verification code emailed to ${email}. Check your inbox and spam folder.`,
        expiresIn: CODE_TTL_MS / 1000,
        delivery: 'console',
        emailConfigured: false,
      })
    }
    const existing = emailVerifications.get(key)
    if (existing && Date.now() - existing.lastSentAt < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt)) / 1000)
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({ message: `Code already sent. Try again in ${retryAfter}s.`, retryAfter })
    }
    const sends = recentSends(existing)
    if (sends.length >= MAX_SENDS_PER_HOUR) {
      const retryAfter = Math.max(1, Math.ceil((sends[0] + SEND_WINDOW_MS - Date.now()) / 1000))
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({ message: 'Too many codes sent to this address. Try again later.', retryAfter })
    }
    const code = generateCode()
    emailVerifications.set(key, {
      codeHash: hashCode(key, code).toString('hex'),
      expiresAt: Date.now() + CODE_TTL_MS,
      attempts: 0,
      verified: false,
      verifiedAt: 0,
      lastSentAt: Date.now(),
      sendTimestamps: [...sends, Date.now()],
    })
    let delivery = 'console'
    let previewUrl = null
    try {
      ;({ delivery, previewUrl = null } = await mailer.sendVerificationEmail(email, code, {
        expiresMinutes: CODE_TTL_MS / 60000,
      }))
    } catch (err) {
      emailVerifications.delete(key)
      // eslint-disable-next-line no-console
      console.error(`[auth] failed to send verification email to ${email}: ${err.message}`)
      return res.status(502).json({
        message: 'Could not send the verification email. Check the address or try again shortly.',
      })
    }
    const payload = {
      message:
        delivery === 'ethereal'
          ? `Verification code sent via test SMTP. Open the preview link to read the email for ${email}.`
          : `Verification code emailed to ${email}. Check your inbox and spam folder.`,
      expiresIn: CODE_TTL_MS / 1000,
      delivery,
      emailConfigured: mailer.isEmailConfigured() || delivery === 'ethereal',
    }
    if (!config.isProd && previewUrl) payload.previewUrl = previewUrl
    return res.json(payload)
  })
)

router.post(
  '/verify-code',
  [
    body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
    body('code').trim().matches(/^\d{6}$/).withMessage('Enter the 6-digit verification code.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { email, code } = req.body
    const key = String(email).toLowerCase()
    const entry = emailVerifications.get(key)
    if (!entry) {
      return res.status(400).json({ message: 'No verification code requested for this email. Send a code first.' })
    }
    if (Date.now() > entry.expiresAt) {
      emailVerifications.delete(key)
      return res.status(400).json({ message: 'Verification code expired. Send a new code.' })
    }
    if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
      emailVerifications.delete(key)
      // eslint-disable-next-line no-console
      console.warn(`[auth] verification locked for ${email} after too many wrong attempts`)
      return res.status(429).json({ message: 'Too many wrong attempts. Send a new code.' })
    }
    if (!demoCodeMatches(code) && !codeMatches(key, code, entry.codeHash)) {
      entry.attempts += 1
      const remaining = MAX_VERIFY_ATTEMPTS - entry.attempts
      return res.status(400).json({ message: `Incorrect code. ${remaining} attempt(s) left.` })
    }
    entry.verified = true
    entry.verifiedAt = Date.now()
    return res.json({ verified: true, message: 'Email verified. You can now create your account.' })
  })
)

router.post(
  '/register',
  [
    body('fullName').trim().isLength({ min: 1 }).withMessage('Full name is required.').isLength({ max: 120 }),
    body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
    ...passwordChecks('password'),
    body('role').optional().isIn(ROLES).withMessage('Invalid role.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { fullName, email, password, role: requestedRole = 'Developer' } = req.body
      const key = String(email).toLowerCase()
      if (await userQuery(req, 'findByEmail', key)) {
        return res.status(409).json({ message: 'Email already registered' })
      }
      const role = config.isProd ? 'Developer' : (ROLES.includes(requestedRole) ? requestedRole : 'Developer')
      if (!consumeVerifiedEmail(email)) {
        return res.status(400).json({ message: 'Please verify your email address with the 6-digit code first.' })
      }
      const passwordHash = await bcrypt.hash(password, 10)
      const user = await userQuery(req, 'createUser', { id: crypto.randomUUID(), fullName, email, role, passwordHash, tokenVersion: 0, createdAt: new Date().toISOString() })
      emailVerifications.delete(key)
      const token = signToken(user)
      const refreshToken = issueRefreshToken(user.id, user.tokenVersion)
      logSecurityEvent({ type: 'user_registered', userId: user.id, email: user.email, ip: req.ip })
      return res.status(201).json({ user: publicUser(user), token, refreshToken })
    } catch (err) {
      if (isEmailConflict(err)) return res.status(409).json({ message: 'Email already registered' })
      return next(err)
    }
  }
)

router.post(
  '/login',
  [
    body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
    body('password').isLength({ min: 1 }).withMessage('Password is required.').isLength({ max: 128 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { email, password } = req.body
      const key = String(email).toLowerCase()
      const attempt = getAttempt(key)
      if (attempt.lockedUntil > Date.now()) {
        return lockoutResponse(res, attempt.lockedUntil)
      }
      const user = await userQuery(req, 'findByEmail', key)
      const ok = user
        ? await bcrypt.compare(password, user.passwordHash)
        : await bcrypt.compare(password, DUMMY_HASH).then(() => false)
      if (!ok) {
        const currentAttempt = getAttempt(key)
        if (currentAttempt.lockedUntil > Date.now()) return lockoutResponse(res, currentAttempt.lockedUntil)
        const count = currentAttempt.count + 1
        if (user && count >= config.maxLoginAttempts) {
          const lockedUntil = Date.now() + config.lockoutMinutes * 60 * 1000
          loginAttempts.set(key, { count, lockedUntil })
          // eslint-disable-next-line no-console
          console.warn(`[security] account locked: ${email} after ${count} failed logins`)
          logSecurityEvent({ type: 'account_locked', email, ip: req.ip, reason: 'too_many_failed_attempts' })
          return lockoutResponse(res, lockedUntil)
        }
        if (user) loginAttempts.set(key, { count, lockedUntil: 0 })
        logSecurityEvent({ type: 'failed_login', email, ip: req.ip })
        const alerts = detectSuspiciousActivity(email)
        if (alerts.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(`[security] suspicious activity detected for ${email}:`, alerts)
        }
        return res.status(401).json({ message: 'Invalid credentials' })
      }
      const currentUser = await userQuery(req, 'findById', user.id)
      if (!currentUser || currentUser.tokenVersion !== user.tokenVersion) return res.status(401).json({ message: 'Invalid credentials' })
      const latestAttempt = getAttempt(key)
      if (latestAttempt.lockedUntil > Date.now()) return lockoutResponse(res, latestAttempt.lockedUntil)
      loginAttempts.delete(key)
      const token = signToken(user)
      const refreshToken = issueRefreshToken(user.id, user.tokenVersion)
      logSecurityEvent({ type: 'login_success', userId: user.id, email: user.email, ip: req.ip })
      return res.json({ user: publicUser(user), token, refreshToken })
    } catch (err) {
      return next(err)
    }
  }
)

router.post(
  '/change-password',
  authRequired,
  [
    body('currentPassword').isLength({ min: 1 }).withMessage('Current password is required.').isLength({ max: 128 }),
    ...passwordChecks('newPassword'),
  ],
  validate,
  async (req, res, next) => {
    try {
      let user = req.authUser
      if (!user) return res.status(401).json({ message: 'Invalid or expired token' })
      const { currentPassword, newPassword } = req.body
      const ok = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!ok) return res.status(401).json({ message: 'Current password is incorrect' })
      if (currentPassword === newPassword) {
        return res.status(400).json({ message: 'New password must be different from the current password' })
      }
      const passwordHash = await bcrypt.hash(newPassword, 10)
      user = await userQuery(req, 'updatePassword', user.id, passwordHash, user.tokenVersion)
      if (!user) return res.status(401).json({ message: 'Invalid or expired token' })
      revokeUserRefreshTokens(user.id)
      loginAttempts.delete(String(user.email).toLowerCase())
      const token = signToken(user)
      const refreshToken = issueRefreshToken(user.id, user.tokenVersion)
      logSecurityEvent({ type: 'password_changed', userId: user.id, email: user.email, ip: req.ip })
      return res.json({ message: 'Password updated', token, refreshToken })
    } catch (err) {
      return next(err)
    }
  }
)

router.get('/me', authRequired, (req, res) => {
  const user = req.authUser
  if (!user) return res.status(401).json({ message: 'Invalid or expired token' })
  return res.json({ user: publicUser(user) })
})

router.get('/sessions', authRequired, (req, res) => {
  const sessions = listUserSessions(req.user.sub)
  return res.json({ sessions })
})

router.delete('/sessions/:id', authRequired, (req, res) => {
  const sessionId = req.params.id
  for (const [hash, record] of refreshTokens) {
    if (record.userId === req.user.sub && hash.startsWith(sessionId)) {
      refreshTokens.delete(hash)
      logSecurityEvent({ type: 'session_revoked', userId: req.user.sub, email: req.user.email, ip: req.ip })
      return res.json({ message: 'Session revoked' })
    }
  }
  return res.status(404).json({ message: 'Session not found', code: 'not_found' })
})

router.post(
  '/refresh',
  [body('refreshToken').isString().isLength({ min: 32, max: 200 }).withMessage('Refresh token is required.')],
  validate,
  asyncHandler(async (req, res) => {
    let record = inspectRefreshToken(req.body.refreshToken)
    if (!record) return res.status(401).json({ message: 'Invalid or expired refresh token', code: 'unauthorized' })
    if (record.reused) {
      consumeRefreshToken(req.body.refreshToken)
      // eslint-disable-next-line no-console
      console.warn(`[security] refresh token reuse detected for user ${record.userId} — sessions revoked`)
      logSecurityEvent({ type: 'refresh_token_reuse', userId: record.userId, ip: req.ip })
      return res.status(401).json({ message: 'Invalid or expired refresh token', code: 'unauthorized' })
    }
    const user = await userQuery(req, 'findById', record.userId)
    record = consumeRefreshToken(req.body.refreshToken)
    if (record && record.reused) logSecurityEvent({ type: 'refresh_token_reuse', userId: record.userId, ip: req.ip })
    if (!record || record.reused || !user || record.tokenVersion !== user.tokenVersion) return res.status(401).json({ message: 'Invalid or expired refresh token', code: 'unauthorized' })
    const token = signToken(user)
    const refreshToken = issueRefreshToken(user.id, user.tokenVersion)
    return res.json({ user: publicUser(user), token, refreshToken })
  })
)

router.post('/logout', async (req, res) => {
  try {
    if (req.body && req.body.refreshToken) revokeRefreshToken(req.body.refreshToken)
    const header = req.headers.authorization || ''
    const [scheme, token] = header.split(' ')
    if (scheme === 'Bearer' && token) {
      try {
        const payload = verifyToken(token)
        if (payload && payload.sub) {
          revokeUserRefreshTokens(payload.sub)
          logSecurityEvent({ type: 'logout', userId: payload.sub, ip: req.ip })
        }
      } catch {
        // ignore invalid access token on logout
      }
    }
  } catch {
    // logout never fails
  }
  return res.json({ message: 'Logged out' })
})

router.post(
  '/forgot-password',
  [body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail()],
  validate,
  asyncHandler(async (req, res) => {
    const { email } = req.body
    const key = String(email).toLowerCase()
    const user = await userQuery(req, 'findByEmail', key)
    if (user) {
      const raw = issuePasswordReset(email, user.tokenVersion)
      // eslint-disable-next-line no-console
      console.warn(`[security] password reset requested for ${email}`)
      logSecurityEvent({ type: 'password_reset_requested', email, ip: req.ip })
      try {
        await mailer.sendPasswordResetEmail(email, raw, {
          expiresMinutes: Math.round(config.passwordResetTtlMs / 60000),
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[auth] failed to send password-reset email to ${email}: ${err.message}`)
      }
    }
    await bcrypt.compare('timing-defense', DUMMY_HASH).catch(() => {})
    return res.json({ message: 'If an account exists for that email, a reset link has been sent.' })
  })
)

router.post(
  '/reset-password',
  [
    body('token').isString().isLength({ min: 32, max: 200 }).withMessage('Reset token is required.'),
    ...passwordChecks('newPassword'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const record = consumePasswordReset(req.body.token)
      if (!record) {
        return res.status(400).json({ message: 'Reset link is invalid or expired. Request a new one.', code: 'invalid_token' })
      }
      let user = await userQuery(req, 'findByEmail', record.emailKey)
      if (!user || record.tokenVersion !== user.tokenVersion) {
        return res.status(400).json({ message: 'Reset link is invalid or expired. Request a new one.', code: 'invalid_token' })
      }
      const passwordHash = await bcrypt.hash(req.body.newPassword, 10)
      user = await userQuery(req, 'updatePassword', user.id, passwordHash, record.tokenVersion)
      if (!user) return res.status(400).json({ message: 'Reset link is invalid or expired. Request a new one.', code: 'invalid_token' })
      revokeUserRefreshTokens(user.id)
      loginAttempts.delete(record.emailKey)
      // eslint-disable-next-line no-console
      console.warn(`[security] password reset completed for ${record.emailKey}`)
      logSecurityEvent({ type: 'password_reset_completed', email: record.emailKey, ip: req.ip })
      return res.json({ message: 'Password has been reset. You can now log in.' })
    } catch (err) {
      return next(err)
    }
  }
)

router.get('/users', authRequired, requireRole('Team Lead', 'Project Manager'), asyncHandler(async (req, res) => {
  const users = await userQuery(req, 'listUsers')
  return res.json({ users })
}))

router.patch(
  '/users/:id/role',
  authRequired,
  requireRole('Team Lead', 'Project Manager'),
  [body('role').isIn(ROLES).withMessage('Invalid role.')],
  validate,
  asyncHandler(async (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) return res.status(404).json({ message: 'User not found', code: 'not_found' })
    let target = await userQuery(req, 'findById', req.params.id)
    if (!target) return res.status(404).json({ message: 'User not found', code: 'not_found' })
    if (target.id === req.user.sub) {
      return res.status(400).json({ message: 'You cannot change your own role', code: 'invalid_operation' })
    }
    const previous = target.role
    target = await userQuery(req, 'updateRole', target.id, req.body.role, target.tokenVersion)
    if (!target) return res.status(409).json({ message: 'User changed concurrently. Try again.', code: 'conflict' })
    revokeUserRefreshTokens(target.id)
    // eslint-disable-next-line no-console
    console.warn(`[security] role change: ${target.email} ${previous} → ${target.role} by ${req.user.email}`)
    logSecurityEvent({ type: 'role_changed', userId: target.id, email: target.email, ip: req.ip, details: { from: previous, to: req.body.role } })
    return res.json({ user: publicUser(target) })
  })
)

module.exports = router
module.exports.ROLES = ROLES
module.exports._store = { emailVerifications, refreshTokens, consumedRefreshTokens, passwordResets, demo: () => ({ email: config.demoEmail, password: config.demoPassword }) }
