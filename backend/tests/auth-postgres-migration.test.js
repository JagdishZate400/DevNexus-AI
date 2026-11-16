require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const request = require('supertest')
const { createTestRepository } = require('./helpers/users')
const mailer = require('../src/services/mailer')
mailer.logEmailStatus = () => {}
mailer.sendVerificationEmail = async () => ({ delivery: 'console' })
mailer.sendPasswordResetEmail = async () => ({ delivery: 'console' })
const { createApp } = require('../src/app')
const { signToken } = require('../src/middleware/auth')
const { issueRefreshToken, issuePasswordReset } = require('../src/services/tokens')
const { usersByEmail } = require('../src/db/memory')

async function fixture(role = 'Developer') {
  const repository = createTestRepository()
  const user = await repository.createUser({
    id: crypto.randomUUID(), fullName: 'Database fixture',
    email: `${crypto.randomUUID()}@example.com`, role,
    passwordHash: bcrypt.hashSync('Password123!', 4), tokenVersion: 0,
  })
  return { repository, user, app: createApp({ userRepository: repository }), token: signToken(user) }
}

function gate() {
  let enter, release
  const entered = new Promise((resolve) => { enter = resolve })
  const released = new Promise((resolve) => { release = resolve })
  return { entered, released, enter, release }
}

const options = { timeout: 10000 }

test('database failures are sanitized server errors, never memory fallback', options, async () => {
  const f = await fixture()
  usersByEmail.set(f.user.email, f.user)
  const fail = async () => { throw new Error('private database connection details') }
  f.repository.findByEmail = fail
  f.repository.findById = fail
  const responses = await Promise.all([
    request(f.app).post('/api/auth/login').send({ email: f.user.email, password: 'Password123!' }),
    request(f.app).get('/api/auth/me').set('Authorization', `Bearer ${f.token}`),
    request(f.app).post('/api/auth/request-code').send({ email: f.user.email }),
    request(f.app).post('/api/auth/forgot-password').send({ email: f.user.email }),
  ])
  for (const res of responses) {
    assert.equal(res.status, 503)
    assert.equal(res.body.code, 'database_unavailable')
    assert.ok(res.body.requestId)
    assert.equal(res.body.token, undefined)
    assert.doesNotMatch(JSON.stringify(res.body), /private/)
  }
  usersByEmail.delete(f.user.email)
})

test('concurrent duplicate registrations return 201 and email-specific 409', options, async () => {
  const repository = createTestRepository()
  const app = createApp({ userRepository: repository })
  const email = `${crypto.randomUUID()}@example.com`
  await request(app).post('/api/auth/request-code').send({ email })
  await request(app).post('/api/auth/verify-code').send({ email, code: '123456' })
  const original = repository.createUser
  const barrier = gate()
  let calls = 0
  repository.createUser = async (user) => {
    if (++calls === 2) barrier.release()
    await barrier.released
    return original(user)
  }
  const results = await Promise.all([1, 2].map(() => request(app).post('/api/auth/register')
    .send({ email, fullName: 'Race', password: 'Password123!' })))
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409])
  assert.equal(results.find((r) => r.status === 409).body.message, 'Email already registered')
})

test('non-email unique failures are server errors rather than duplicate-email responses', options, async () => {
  const f = await fixture()
  const email = `${crypto.randomUUID()}@example.com`
  await request(f.app).post('/api/auth/request-code').send({ email })
  await request(f.app).post('/api/auth/verify-code').send({ email, code: '123456' })
  f.repository.createUser = async () => { throw Object.assign(new Error('private'), { code: '23505', constraint: 'users_pkey' }) }
  const res = await request(f.app).post('/api/auth/register').send({ email, fullName: 'Race', password: 'Password123!' })
  assert.equal(res.status, 503)
})

test('concurrent refresh rotates once and replay revokes the replacement', options, async () => {
  const f = await fixture()
  const raw = issueRefreshToken(f.user.id, 0)
  const original = f.repository.findById
  const barrier = gate()
  let calls = 0
  f.repository.findById = async (id) => {
    const row = await original(id)
    if (++calls === 2) barrier.release()
    await barrier.released
    return row
  }
  const results = await Promise.all([1, 2].map(() => request(f.app).post('/api/auth/refresh').send({ refreshToken: raw })))
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401])
  const replacement = results.find((r) => r.status === 200).body.refreshToken
  assert.equal((await request(f.app).post('/api/auth/refresh').send({ refreshToken: replacement })).status, 401)
})

test('logout during refresh database lookup prevents new credentials', options, async () => {
  const f = await fixture()
  const raw = issueRefreshToken(f.user.id, 0)
  const original = f.repository.findById
  const barrier = gate()
  f.repository.findById = async (id) => {
    const row = await original(id)
    barrier.enter()
    await barrier.released
    return row
  }
  const pending = request(f.app).post('/api/auth/refresh').send({ refreshToken: raw }).then((r) => r)
  await barrier.entered
  await request(f.app).post('/api/auth/logout').send({ refreshToken: raw })
  barrier.release()
  assert.equal((await pending).status, 401)
})

test('database outage leaves unconsumed refresh available for a retry', options, async () => {
  const f = await fixture()
  const raw = issueRefreshToken(f.user.id, 0)
  const original = f.repository.findById
  f.repository.findById = async () => { throw new Error('offline') }
  assert.equal((await request(f.app).post('/api/auth/refresh').send({ refreshToken: raw })).status, 503)
  f.repository.findById = original
  assert.equal((await request(f.app).post('/api/auth/refresh').send({ refreshToken: raw })).status, 200)
})

test('credential version changes reject refresh and reset tokens issued earlier', options, async () => {
  const f = await fixture()
  const refreshToken = issueRefreshToken(f.user.id, 0)
  const resetToken = issuePasswordReset(f.user.email, 0)
  await f.repository.updateRole(f.user.id, 'Team Lead', 0)
  assert.equal((await request(f.app).post('/api/auth/refresh').send({ refreshToken })).status, 401)
  assert.equal((await request(f.app).post('/api/auth/reset-password').send({ token: resetToken, newPassword: 'NewPassword123!' })).status, 400)
  assert.equal((await request(f.app).get('/api/auth/me').set('Authorization', `Bearer ${f.token}`)).status, 401)
})

test('concurrent resets consume once and pass the expected version to storage', options, async () => {
  const f = await fixture()
  const raw = issuePasswordReset(f.user.email, 0)
  const original = f.repository.updatePassword
  const versions = []
  f.repository.updatePassword = async (...args) => { versions.push(args[2]); return original(...args) }
  const results = await Promise.all([1, 2].map(() => request(f.app).post('/api/auth/reset-password')
    .send({ token: raw, newPassword: 'NewPassword123!' })))
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400])
  assert.deepEqual(versions, [0])
  assert.equal((await f.repository.findById(f.user.id)).tokenVersion, 1)
})

test('password change cannot overwrite credentials changed during bcrypt work', options, async () => {
  const f = await fixture()
  const original = f.repository.updatePassword
  f.repository.updatePassword = async (...args) => {
    assert.equal(args[2], 0)
    await f.repository.updateRole(f.user.id, 'Team Lead', 0)
    return original(...args)
  }
  const res = await request(f.app).post('/api/auth/change-password').set('Authorization', `Bearer ${f.token}`)
    .send({ currentPassword: 'Password123!', newPassword: 'NewPassword123!' })
  assert.equal(res.status, 401)
  assert.equal(res.body.token, undefined)
  assert.ok(await bcrypt.compare('Password123!', (await f.repository.findById(f.user.id)).passwordHash))
})

test('role conflicts return 409 without reporting success', options, async () => {
  const f = await fixture('Team Lead')
  const target = await f.repository.createUser({ ...f.user, id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, role: 'Developer' })
  const original = f.repository.updateRole
  f.repository.updateRole = async (...args) => {
    assert.equal(args[2], 0)
    await original(args[0], 'Project Manager', 0)
    return original(...args)
  }
  const res = await request(f.app).patch(`/api/auth/users/${target.id}/role`).set('Authorization', `Bearer ${f.token}`).send({ role: 'Team Lead' })
  assert.equal(res.status, 409)
  assert.equal((await f.repository.findById(target.id)).role, 'Project Manager')
})

test('failed reset updates burn the token and never report success', options, async () => {
  const f = await fixture()
  const raw = issuePasswordReset(f.user.email, 0)
  f.repository.updatePassword = async () => { throw new Error('unknown commit outcome') }
  const payload = { token: raw, newPassword: 'NewPassword123!' }
  assert.equal((await request(f.app).post('/api/auth/reset-password').send(payload)).status, 503)
  assert.equal((await request(f.app).post('/api/auth/reset-password').send(payload)).status, 400)
})


test('password change during an outstanding refresh revokes its pending rotation', options, async () => {
  const f = await fixture()
  const raw = issueRefreshToken(f.user.id, 0)
  const original = f.repository.findById
  const barrier = gate()
  let first = true
  f.repository.findById = async (id) => {
    const row = await original(id)
    if (first) {
      first = false
      barrier.enter()
      await barrier.released
    }
    return row
  }
  const pending = request(f.app).post('/api/auth/refresh').send({ refreshToken: raw }).then((r) => r)
  await barrier.entered
  const changed = await request(f.app).post('/api/auth/change-password').set('Authorization', `Bearer ${f.token}`)
    .send({ currentPassword: 'Password123!', newPassword: 'NewPassword123!' })
  assert.equal(changed.status, 200)
  barrier.release()
  assert.equal((await pending).status, 401)
  assert.equal((await request(f.app).post('/api/auth/refresh').send({ refreshToken: changed.body.refreshToken })).status, 200)
})

test('concurrent wrong passwords accumulate lockout rather than losing counters', options, async () => {
  const f = await fixture()
  const responses = await Promise.all(Array.from({ length: 5 }, () => request(f.app).post('/api/auth/login')
    .send({ email: f.user.email, password: 'WrongPassword123!' })))
  assert.equal(responses.filter((r) => r.status === 423).length, 1)
  const locked = await request(f.app).post('/api/auth/login').send({ email: f.user.email, password: 'Password123!' })
  assert.equal(locked.status, 423)
  assert.ok(locked.headers['retry-after'])
})

test('offline authentication tests never load PostgreSQL modules', () => {
  assert.equal(require.cache[require.resolve('../src/db/postgres')], undefined)
  assert.equal(require.cache[require.resolve('../src/db/users')], undefined)
})
