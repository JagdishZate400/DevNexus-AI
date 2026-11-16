require('./helpers/offline')
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-chars-long!!'
process.env.CORS_ORIGIN = 'http://localhost:5173'
process.env.DEMO_VERIFICATION_CODE = process.env.DEMO_VERIFICATION_CODE || '123456'
// Keep tests offline: never open Ethereal/Gmail during the suite.
process.env.SMTP_MODE = 'console'
process.env.SMTP_HOST = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASS = ''

const mailer = require('../src/services/mailer')
mailer._resetTransporter()
mailer.logEmailStatus = async () => {}
mailer.verifySmtpConnection = async () => ({ ok: false, reason: 'test' })

// Capture outbound codes at the mailer seam: the API never returns codes
// (they go to the inbox), so tests observe what would have been emailed.
const sentEmails = []
mailer.sendVerificationEmail = async (to, code, opts) => {
  sentEmails.push({ to, code, opts })
  return { delivery: 'console' }
}

const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const userRepository = createTestRepository()
const { emailVerifications } = require('../src/routes/auth')._store

let app
before(() => {
  app = createApp({ userRepository })
})

function lastCodeFor(email) {
  const found = [...sentEmails].reverse().find((m) => String(m.to).toLowerCase() === email.toLowerCase())
  assert.ok(found, `no verification email captured for ${email}`)
  assert.match(found.code, /^\d{6}$/)
  return found.code
}

// Codes are emailed, never returned by the API — tests read what the mailer
// received and assert the response leaks nothing.
async function requestAndReadCode(email) {
  const res = await request(app).post('/api/auth/request-code').send({ email })
  assert.equal(res.status, 200)
  assert.equal(res.body.debugCode, undefined)
  return lastCodeFor(email)
}

test('health check', async () => {
  const res = await request(app).get('/health')
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'ok')
})

test('projects require auth', async () => {
  const res = await request(app).get('/api/projects')
  assert.equal(res.status, 401)
})

test('register validates email + password', async () => {
  const res = await request(app).post('/api/auth/register').send({ email: 'bad', password: 'short' })
  assert.equal(res.status, 400)
  assert.ok(res.body.errors.length >= 1)
})

test('register -> login -> me -> create project', async () => {
  const email = `user-${Date.now()}@example.com`
  const code = await requestAndReadCode(email)
  const verify = await request(app).post('/api/auth/verify-code').send({ email, code })
  assert.equal(verify.status, 200)
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ fullName: 'Test User', email, password: 'Password123!', role: 'Developer' })
  assert.equal(reg.status, 201)
  assert.ok(reg.body.token)

  const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })
  assert.equal(login.status, 200)
  const token = login.body.token

  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
  assert.equal(me.status, 200)
  assert.equal(me.body.user.email, email)

  const created = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'E2E Project', description: 'Created by backend test' })
  assert.equal(created.status, 201)

  const list = await request(app).get('/api/projects').set('Authorization', `Bearer ${token}`)
  assert.equal(list.status, 200)
  assert.ok(list.body.projects.length >= 1)
})

test('wrong password rejected', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'test@example.com', password: 'wrong' })
  assert.equal(res.status, 401)
})

test('security headers present, powered-by hidden', async () => {
  const res = await request(app).get('/health')
  assert.ok(res.headers['content-security-policy'] || res.headers['x-content-type-options'])
  assert.equal(res.headers['x-powered-by'], undefined)
})

test('CORS blocks unknown origin', async () => {
  const res = await request(app).get('/health').set('Origin', 'https://evil.example')
  // CORS middleware only gates API? health is public; evil origin gets no ACAO header.
  assert.equal(res.headers['access-control-allow-origin'], undefined)
})

test('weak passwords rejected on register', async () => {
  for (const password of ['short', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoDigitsHere!', 'NoSymbols123']) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Weak Test', email: `weak-${Date.now()}-${password.length}@example.com`, password })
    assert.equal(res.status, 400, password)
  }
})

test('repeated failures lock the account (423)', async () => {
  const email = `lockout-${Date.now()}@example.com`
  const code = await requestAndReadCode(email)
  await request(app).post('/api/auth/verify-code').send({ email, code })
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ fullName: 'Lockout Test', email, password: 'Password123!' })
  assert.equal(reg.status, 201)

  for (let i = 0; i < 4; i += 1) {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'Wrong123!' })
    assert.equal(res.status, 401)
  }
  const locked = await request(app).post('/api/auth/login').send({ email, password: 'Wrong123!' })
  assert.equal(locked.status, 423)
  assert.ok(locked.body.retryAfter > 0)

  // Correct password is also rejected while locked.
  const denied = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })
  assert.equal(denied.status, 423)
})

test('change password rotates credentials', async () => {
  const email = `rotate-${Date.now()}@example.com`
  const code = await requestAndReadCode(email)
  await request(app).post('/api/auth/verify-code').send({ email, code })
  await request(app)
    .post('/api/auth/register')
    .send({ fullName: 'Rotate Test', email, password: 'Password123!' })

  const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })
  assert.equal(login.status, 200)
  const oldToken = login.body.token

  const wrongCurrent = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${oldToken}`)
    .send({ currentPassword: 'Wrong123!', newPassword: 'NewPassword456!' })
  assert.equal(wrongCurrent.status, 401)

  const weakNew = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${oldToken}`)
    .send({ currentPassword: 'Password123!', newPassword: 'weak' })
  assert.equal(weakNew.status, 400)

  const changed = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${oldToken}`)
    .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' })
  assert.equal(changed.status, 200)
  assert.ok(changed.body.token)

  // Old token is dead, new token works.
  const stale = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`)
  assert.equal(stale.status, 401)
  const fresh = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${changed.body.token}`)
  assert.equal(fresh.status, 200)

  // New password logs in.
  const relogin = await request(app).post('/api/auth/login').send({ email, password: 'NewPassword456!' })
  assert.equal(relogin.status, 200)
})

test('change password requires auth', async () => {
  const res = await request(app)
    .post('/api/auth/change-password')
    .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' })
  assert.equal(res.status, 401)
})

test('register requires a verified email code', async () => {
  const email = `unverified-${Date.now()}@example.com`
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ fullName: 'Unverified Test', email, password: 'Password123!' })
  assert.equal(reg.status, 400)
  assert.match(reg.body.message || '', /verify/i)
})

test('verification rejects wrong codes and enforces resend cooldown', async () => {
  const email = `verify-${Date.now()}@example.com`
  const first = await request(app).post('/api/auth/request-code').send({ email })
  assert.equal(first.status, 200)
  assert.equal(first.body.debugCode, undefined)
  const sentCode = lastCodeFor(email)

  const cooldown = await request(app).post('/api/auth/request-code').send({ email })
  assert.equal(cooldown.status, 429)

  const wrong = await request(app).post('/api/auth/verify-code').send({ email, code: '000000' })
  assert.equal(wrong.status, 400)

  const ok = await request(app).post('/api/auth/verify-code').send({ email, code: sentCode })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.verified, true)

  const reg = await request(app)
    .post('/api/auth/register')
    .send({ fullName: 'Verify Test', email, password: 'Password123!' })
  assert.equal(reg.status, 201)
})

test('demo verification code verifies without the emailed code', async () => {
  const email = `demo-code-${Date.now()}@example.com`
  const requested = await request(app).post('/api/auth/request-code').send({ email })
  assert.equal(requested.status, 200)
  // Demo code still requires a pending request for the address.
  const noEntry = await request(app)
    .post('/api/auth/verify-code')
    .send({ email: `no-request-${Date.now()}@example.com`, code: '123456' })
  assert.equal(noEntry.status, 400)
  const ok = await request(app).post('/api/auth/verify-code').send({ email, code: '123456' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.verified, true)
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ fullName: 'Demo Code Test', email, password: 'Password123!' })
  assert.equal(reg.status, 201)
})

test('codes are stored hashed, never plaintext', async () => {
  const email = `hash-${Date.now()}@example.com`
  await requestAndReadCode(email)
  const entry = emailVerifications.get(email.toLowerCase())
  assert.ok(entry)
  assert.equal(entry.code, undefined)
  assert.match(entry.codeHash || '', /^[a-f0-9]{64}$/)
})

test('one address is capped at 5 codes per hour', async () => {
  const email = `cap-${Date.now()}@example.com`
  for (let i = 0; i < 5; i += 1) {
    const res = await request(app).post('/api/auth/request-code').send({ email })
    assert.equal(res.status, 200)
    // Fast-forward past the 30s resend cooldown (same process store).
    emailVerifications.get(email.toLowerCase()).lastSentAt -= 31 * 1000
  }
  const capped = await request(app).post('/api/auth/request-code').send({ email })
  assert.equal(capped.status, 429)
  assert.ok(capped.body.retryAfter > 0)
})

test('SMTP failure surfaces 502 without stranding the user', async () => {
  const email = `smtp-fail-${Date.now()}@example.com`
  const original = mailer.sendVerificationEmail
  mailer.sendVerificationEmail = async () => { throw new Error('smtp down') }
  try {
    const res = await request(app).post('/api/auth/request-code').send({ email })
    assert.equal(res.status, 502)
    // Entry rolled back: an immediate retry is not cooldown-blocked.
    assert.equal(emailVerifications.has(email.toLowerCase()), false)
  } finally {
    mailer.sendVerificationEmail = original
  }
})
