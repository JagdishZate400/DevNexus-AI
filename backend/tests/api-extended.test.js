require('./helpers/offline')
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')

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
const resetEmails = []
const origReset = mailer.sendPasswordResetEmail
mailer.sendPasswordResetEmail = async (to, token) => {
  resetEmails.push({ to, token })
  return { delivery: 'console' }
}
mailer.sendWelcomeEmail = async () => ({ delivery: 'console' })

const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const userRepository = createTestRepository()

let app
before(() => {
  app = createApp({ userRepository, reportsRepository: {summary:async()=>({projects:{total:0},tasks:{total:0},sprints:{total:0},team:{total:0},reviews:{total:0},documents:{total:0},security:{total:0}})} })
})

async function registerUser(email, role = 'Developer') {
  await request(app).post('/api/auth/request-code').send({ email })
  const verify = await request(app).post('/api/auth/verify-code').send({ email, code: '123456' })
  assert.equal(verify.status, 200)
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ fullName: 'Ext Test', email, password: 'Password123!', role })
  assert.equal(reg.status, 201)
  assert.ok(reg.body.token)
  assert.ok(reg.body.refreshToken)
  return reg.body
}

test('health exposes version + request id', async () => {
  const res = await request(app).get('/health')
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'ok')
  assert.ok(res.body.version)
  assert.ok(res.headers['x-request-id'])
})

test('openapi spec lists new domains', async () => {
  const res = await request(app).get('/api/openapi.json')
  assert.equal(res.status, 200)
  assert.ok(res.body.paths['/tasks'])
  assert.ok(res.body.paths['/ai/conversations/{id}/messages'])
  assert.ok(res.body.paths['/reports/summary'])
})

test('projects CRUD + pagination + ownership', async () => {
  const u1 = await registerUser(`proj1-${Date.now()}@example.com`)
  const u2 = await registerUser(`proj2-${Date.now()}@example.com`)

  const a = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${u1.token}`)
    .send({ name: 'Alpha Project', description: 'First', stack: ['Node.js'] })
  assert.equal(a.status, 201)
  const id = a.body.project.id

  await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${u1.token}`)
    .send({ name: 'Beta Project', description: 'Second' })

  const paged = await request(app).get('/api/projects?limit=1&page=1').set('Authorization', `Bearer ${u1.token}`)
  assert.equal(paged.status, 200)
  assert.equal(paged.body.projects.length, 1)
  assert.ok(paged.body.pagination.total >= 2)

  const search = await request(app).get('/api/projects?search=alpha').set('Authorization', `Bearer ${u1.token}`)
  assert.ok(search.body.projects.some((p) => p.id === id))

  // Non-owner developer cannot edit.
  const forbidden = await request(app)
    .patch(`/api/projects/${id}`)
    .set('Authorization', `Bearer ${u2.token}`)
    .send({ description: 'hijack' })
  assert.equal(forbidden.status, 403)

  const lead = await registerUser(`lead-${Date.now()}@example.com`, 'Team Lead')
  const managerEdit = await request(app)
    .patch(`/api/projects/${id}`)
    .set('Authorization', `Bearer ${lead.token}`)
    .send({ description: 'Lead triage update' })
  assert.equal(managerEdit.status, 200)

  const ownEdit = await request(app)
    .patch(`/api/projects/${id}`)
    .set('Authorization', `Bearer ${u1.token}`)
    .send({ progress: 40 })
  assert.equal(ownEdit.status, 200)
  assert.equal(ownEdit.body.project.progress, 40)

  const del = await request(app).delete(`/api/projects/${id}`).set('Authorization', `Bearer ${u1.token}`)
  assert.equal(del.status, 204)
  const gone = await request(app).get(`/api/projects/${id}`).set('Authorization', `Bearer ${u1.token}`)
  assert.equal(gone.status, 404)
})

test('tasks CRUD + filters', async () => {
  const u = await registerUser(`task-${Date.now()}@example.com`)
  const auth = `Bearer ${u.token}`
  const created = await request(app)
    .post('/api/tasks')
    .set('Authorization', auth)
    .send({ title: 'Write extended tests', project: 'Backend', priority: 'High' })
  assert.equal(created.status, 201)
  const id = created.body.task.id

  const bad = await request(app).post('/api/tasks').set('Authorization', auth).send({ title: '' })
  assert.equal(bad.status, 400)

  const list = await request(app).get('/api/tasks?priority=High').set('Authorization', auth)
  assert.ok(list.body.tasks.some((t) => t.id === id))

  const patched = await request(app).patch(`/api/tasks/${id}`).set('Authorization', auth).send({ status: 'Done' })
  assert.equal(patched.body.task.status, 'Done')

  const del = await request(app).delete(`/api/tasks/${id}`).set('Authorization', auth)
  assert.equal(del.status, 204)
})

test('sprints activate demotes previous active', async () => {
  const u = await registerUser(`sprint-${Date.now()}@example.com`)
  const auth = `Bearer ${u.token}`
  const s1 = await request(app).post('/api/sprints').set('Authorization', auth).send({ name: 'S-A' })
  const s2 = await request(app).post('/api/sprints').set('Authorization', auth).send({ name: 'S-B' })
  assert.equal(s1.status, 201)
  await request(app).post(`/api/sprints/${s1.body.sprint.id}/activate`).set('Authorization', auth)
  await request(app).post(`/api/sprints/${s2.body.sprint.id}/activate`).set('Authorization', auth)
  const list = await request(app).get('/api/sprints').set('Authorization', auth)
  const active = list.body.sprints.filter((s) => s.status === 'Active')
  assert.ok(active.some((s) => s.id === s2.body.sprint.id))
  assert.ok(!active.some((s) => s.id === s1.body.sprint.id))
  const done = await request(app).post(`/api/sprints/${s2.body.sprint.id}/complete`).set('Authorization', auth)
  assert.equal(done.body.sprint.status, 'Completed')
  assert.equal(done.body.sprint.progress, 100)
})

test('team invite/list/update/remove', async () => {
  const u = await registerUser(`team-${Date.now()}@example.com`, 'Team Lead')
  const auth = `Bearer ${u.token}`
  const email = `member-${Date.now()}@example.com`
  const inv = await request(app).post('/api/team/invite').set('Authorization', auth).send({ name: 'New Member', email })
  assert.equal(inv.status, 201)
  const dup = await request(app).post('/api/team/invite').set('Authorization', auth).send({ name: 'Dup', email })
  assert.equal(dup.status, 409)
  const upd = await request(app).patch(`/api/team/${inv.body.member.id}`).set('Authorization', auth).send({ status: 'Active' })
  assert.equal(upd.body.member.status, 'Active')
  const del = await request(app).delete(`/api/team/${inv.body.member.id}`).set('Authorization', auth)
  assert.equal(del.status, 204)
})

test('reviews + documents lifecycle', async () => {
  const u = await registerUser(`rdoc-${Date.now()}@example.com`)
  const auth = `Bearer ${u.token}`
  const rev = await request(app).post('/api/reviews').set('Authorization', auth).send({ projectId: 'workspace', scope: 'backend' })
  assert.equal(rev.status, 201)
  assert.ok(rev.body.review.findings.length >= 2)
  const got = await request(app).get(`/api/reviews/${rev.body.review.id}`).set('Authorization', auth)
  assert.equal(got.status, 200)

  const types = await request(app).get('/api/documents/types').set('Authorization', auth)
  assert.ok(types.body.types.includes('readme'))
  const doc = await request(app)
    .post('/api/documents/generate')
    .set('Authorization', auth)
    .send({ projectId: 'workspace', project: 'Workspace', type: 'readme' })
  assert.equal(doc.status, 201)
  const patched = await request(app)
    .patch(`/api/documents/${doc.body.document.id}`)
    .set('Authorization', auth)
    .send({ status: 'Needs Update' })
  assert.equal(patched.body.document.status, 'Needs Update')
})

test('ai chat ask + history (mock provider offline)', async () => {
  const u = await registerUser(`ai-${Date.now()}@example.com`)
  const auth = `Bearer ${u.token}`
  const conv = await request(app).post('/api/ai/conversations').set('Authorization', auth).send({ projectId: 'workspace' })
  assert.equal(conv.status, 201)
  const msg = await request(app)
    .post(`/api/ai/conversations/${conv.body.conversation.id}/messages`)
    .set('Authorization', auth)
    .send({ message: 'How do I run backend tests?' })
  assert.equal(msg.status, 201)
  assert.ok(msg.body.assistantMessage.content.length > 10)
  assert.ok(['mock', 'mock-fallback', 'ai-service'].includes(msg.body.assistantMessage.provider))
  const ask = await request(app).post('/api/ai/ask').set('Authorization', auth).send({ message: 'What is JWT?' })
  assert.equal(ask.status, 201)
})

test('activity + reports + dashboard', async () => {
  const u = await registerUser(`insights-${Date.now()}@example.com`)
  const auth = `Bearer ${u.token}`
  await request(app).post('/api/projects').set('Authorization', auth).send({ name: 'Insight P', description: 'x' })
  const act = await request(app).get('/api/activity?limit=5').set('Authorization', auth)
  assert.equal(act.status, 200)
  assert.ok(Array.isArray(act.body.activity))
  const rep = await request(app).get('/api/reports/summary').set('Authorization', auth)
  assert.equal(rep.status, 200)
  assert.equal(rep.body.projects.total, 0) // Legacy memory project is not a durable report project.
  const dash = await request(app).get('/api/dashboard').set('Authorization', auth)
  assert.ok(typeof dash.body.stats.projects === 'number')
})

test('refresh rotates + logout revokes', async () => {
  const email = `sess-${Date.now()}@example.com`
  const u = await registerUser(email)
  const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken: u.refreshToken })
  assert.equal(r1.status, 200)
  assert.ok(r1.body.token)
  // Old refresh token was rotated: single use.
  const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: u.refreshToken })
  assert.equal(reuse.status, 401)
  const logout = await request(app).post('/api/auth/logout').send({ refreshToken: r1.body.refreshToken })
  assert.equal(logout.status, 200)
  const afterLogout = await request(app).post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken })
  assert.equal(afterLogout.status, 401)
})

test('forgot + reset password recovers account', async () => {
  const email = `reset-${Date.now()}@example.com`
  const u = await registerUser(email)
  const forgot = await request(app).post('/api/auth/forgot-password').send({ email })
  assert.equal(forgot.status, 200)
  assert.ok(resetEmails.length >= 1)
  const raw = resetEmails[resetEmails.length - 1].token
  assert.ok(raw && raw.length >= 32)
  const reset = await request(app).post('/api/auth/reset-password').send({ token: raw, newPassword: 'BrandNew123!' })
  assert.equal(reset.status, 200)
  // Old refresh token revoked by reset.
  const staleRefresh = await request(app).post('/api/auth/refresh').send({ refreshToken: u.refreshToken })
  assert.equal(staleRefresh.status, 401)
  const login = await request(app).post('/api/auth/login').send({ email, password: 'BrandNew123!' })
  assert.equal(login.status, 200)
  // Reused reset token is single-use.
  const reuse = await request(app).post('/api/auth/reset-password').send({ token: raw, newPassword: 'Other123!x' })
  assert.equal(reuse.status, 400)
})

test('change-password still rotates + issues refresh', async () => {
  const email = `chg-${Date.now()}@example.com`
  const u = await registerUser(email)
  const changed = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${u.token}`)
    .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' })
  assert.equal(changed.status, 200)
  assert.ok(changed.body.refreshToken)
})
