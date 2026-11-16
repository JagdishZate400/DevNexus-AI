require('./helpers/offline')
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-chars-long!!'
process.env.CORS_ORIGIN = 'http://localhost:5173'
process.env.DEMO_VERIFICATION_CODE = process.env.DEMO_VERIFICATION_CODE || '123456'
process.env.SMTP_MODE = 'console'
process.env.SMTP_HOST = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASS = ''

const mailer = require('../src/services/mailer')
mailer._resetTransporter()
mailer.logEmailStatus = async () => {}
mailer.verifySmtpConnection = async () => ({ ok: false, reason: 'test' })
mailer.sendVerificationEmail = async () => ({ delivery: 'console' })
mailer.sendPasswordResetEmail = async () => ({ delivery: 'console' })
mailer.sendWelcomeEmail = async () => ({ delivery: 'console' })

const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const userRepository = createTestRepository()

let app
before(() => {
  app = createApp({ userRepository })
})

async function registerUser(email, role = 'Developer') {
  await request(app).post('/api/auth/request-code').send({ email })
  const verify = await request(app).post('/api/auth/verify-code').send({ email, code: '123456' })
  assert.equal(verify.status, 200)
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ fullName: 'Hardening Test', email, password: 'Password123!', role })
  assert.equal(reg.status, 201)
  return reg.body
}

test('request-code hides registration status (no enumeration)', async () => {
  const email = `enum-${Date.now()}@example.com`
  await registerUser(email)
  const res = await request(app).post('/api/auth/request-code').send({ email })
  assert.equal(res.status, 200)
  assert.equal(res.body.debugCode, undefined)
})

test('wrong-algorithm and wrong-issuer tokens rejected', async () => {
  const u = await registerUser(`jwt-${Date.now()}@example.com`)
  const decoded = jwt.decode(u.token)
  assert.equal(decoded.iss, 'ai-engineer-api')
  assert.equal(decoded.aud, 'ai-engineer-app')

  const wrongAlg = jwt.sign(
    { sub: decoded.sub, email: decoded.email, role: 'Developer', tv: 0 },
    process.env.JWT_SECRET,
    { algorithm: 'HS384', issuer: 'ai-engineer-api', audience: 'ai-engineer-app', expiresIn: '1h' }
  )
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${wrongAlg}`)).status, 401)

  const wrongIss = jwt.sign(
    { sub: decoded.sub, email: decoded.email, role: 'Developer', tv: 0 },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: 'evil-issuer', audience: 'ai-engineer-app', expiresIn: '1h' }
  )
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${wrongIss}`)).status, 401)

  const expired = jwt.sign(
    { sub: decoded.sub, email: decoded.email, role: 'Developer', tv: 0 },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: 'ai-engineer-api', audience: 'ai-engineer-app', expiresIn: '-10s' }
  )
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`)).status, 401)
})

test('refresh reuse revokes all sessions (theft detection)', async () => {
  const email = `reuse-${Date.now()}@example.com`
  const u = await registerUser(email)
  const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken: u.refreshToken })
  assert.equal(r1.status, 200)
  // Attacker replays the already-rotated token.
  const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: u.refreshToken })
  assert.equal(replay.status, 401)
  // Legitimate rotated token is now dead too — every session revoked.
  const victim = await request(app).post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken })
  assert.equal(victim.status, 401)
  // ...but the password still works for a fresh login.
  const relogin = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })
  assert.equal(relogin.status, 200)
})

test('role admin: list, promote, no self-demote, dev forbidden', async () => {
  const devEmail = `roledev-${Date.now()}@example.com`
  const leadEmail = `rolelead-${Date.now()}@example.com`
  const dev = await registerUser(devEmail)
  const lead = await registerUser(leadEmail, 'Team Lead')

  assert.equal((await request(app).get('/api/auth/users').set('Authorization', `Bearer ${dev.token}`)).status, 403)
  const list = await request(app).get('/api/auth/users').set('Authorization', `Bearer ${lead.token}`)
  assert.equal(list.status, 200)
  assert.ok(Array.isArray(list.body.users) && list.body.users.length >= 2)
  assert.ok(list.body.users.some((x) => x.email === devEmail))

  // Developer cannot promote anyone.
  const selfServe = await request(app)
    .patch(`/api/auth/users/${lead.user.id}/role`)
    .set('Authorization', `Bearer ${dev.token}`)
    .send({ role: 'Developer' })
  assert.equal(selfServe.status, 403)

  // Lead cannot change their own role.
  const selfDemote = await request(app)
    .patch(`/api/auth/users/${lead.user.id}/role`)
    .set('Authorization', `Bearer ${lead.token}`)
    .send({ role: 'Developer' })
  assert.equal(selfDemote.status, 400)

  // Lead promotes the developer. Promotion rotates credentials (old tokens
  // die, like a password change), so the dev signs in again and the fresh
  // session carries the new role.
  const promoted = await request(app)
    .patch(`/api/auth/users/${dev.user.id}/role`)
    .set('Authorization', `Bearer ${lead.token}`)
    .send({ role: 'Team Lead' })
  assert.equal(promoted.status, 200)
  assert.equal(promoted.body.user.role, 'Team Lead')
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${dev.token}`)).status, 401)
  const fresh = await request(app).post('/api/auth/login').send({ email: devEmail, password: 'Password123!' })
  assert.equal(fresh.status, 200)
  assert.equal(fresh.body.user.role, 'Team Lead')
  const invite = await request(app)
    .post('/api/team/invite')
    .set('Authorization', `Bearer ${fresh.body.token}`)
    .send({ name: 'Promoted Invite', email: `promo-${Date.now()}@example.com` })
  assert.equal(invite.status, 201)
})

test('team management is lead-only; roster stays readable', async () => {
  const dev = await registerUser(`tmdev-${Date.now()}@example.com`)
  assert.equal((await request(app).get('/api/team').set('Authorization', `Bearer ${dev.token}`)).status, 200)
  assert.equal(
    (await request(app).post('/api/team/invite').set('Authorization', `Bearer ${dev.token}`).send({ name: 'X', email: `x-${Date.now()}@example.com` })).status,
    403
  )
})

test('tasks are creator/assignee/lead-scoped', async () => {
  const a = await registerUser(`taska-${Date.now()}@example.com`)
  const b = await registerUser(`taskb-${Date.now()}@example.com`)
  const created = await request(app)
    .post('/api/tasks')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ title: 'Scoped task' })
  assert.equal(created.status, 201)
  const id = created.body.task.id
  assert.equal(
    (await request(app).patch(`/api/tasks/${id}`).set('Authorization', `Bearer ${b.token}`).send({ status: 'Done' })).status,
    403
  )
  assert.equal((await request(app).delete(`/api/tasks/${id}`).set('Authorization', `Bearer ${b.token}`)).status, 403)
  assert.equal(
    (await request(app).patch(`/api/tasks/${id}`).set('Authorization', `Bearer ${a.token}`).send({ status: 'Done' })).status,
    200
  )
})
