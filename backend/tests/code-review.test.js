require('./helpers/offline')
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')

process.env.JWT_SECRET = 'code-review-test-secret-at-least-32-characters'
const mailer = require('../src/services/mailer')
mailer.logEmailStatus = async () => {}
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const userRepository = createTestRepository()
const { reviews } = require('../src/db/memory')
const { signToken } = require('../src/middleware/auth')
let app, token
before(async () => {
  app = createApp({ userRepository })
  const user = { id: require('crypto').randomUUID(), email: 'code-review@example.com', role: 'Developer', tokenVersion: 0 }
  await userRepository.createUser(user)
  token = signToken(user)
})

function analyze(payload) {
  return request(app).post('/api/reviews/analyze').set('Authorization', `Bearer ${token}`).send(payload)
}

test('seeded review history exposes findings arrays separately from numeric counts', async () => {
  const res = await request(app).get('/api/reviews').set('Authorization', `Bearer ${token}`)
  assert.equal(res.status, 200)
  for (const review of res.body.reviews) assert.ok(Array.isArray(review.findings))
  const seed = res.body.reviews.find((review) => review.id === 'review-1')
  assert.equal(seed.findingsCount, 3)
  assert.deepEqual(seed.findings, [])
})

test('source analysis requires valid authentication', async () => {
  const payload = { code: 'eval(input)', language: 'javascript' }
  assert.equal((await request(app).post('/api/reviews/analyze').send(payload)).status, 401)
  assert.equal((await request(app).post('/api/reviews/analyze').set('Authorization', 'Bearer mock.demo').send(payload)).status, 401)
})

test('source endpoint is included in existing API documentation', async () => {
  const res = await request(app).get('/api/openapi.json')
  assert.equal(res.status, 200)
  assert.ok(res.body.paths['/reviews/analyze'].post)
})

test('source validation rejects missing, blank, non-string, oversized code and unsupported language without echoing input', async () => {
  for (const payload of [{}, { code: '  ', language: 'javascript' }, { code: {}, language: 'javascript' }, { code: 'x'.repeat(50001), language: 'javascript' }, { code: 'x', language: 'python' }, { code: 'x', language: ['javascript'] }, { code: 'x', language: 'javascript', file: 42 }]) {
    const res = await analyze(payload)
    assert.equal(res.status, 400)
    assert.ok(res.body.errors.length)
    assert.equal(res.body.code, undefined)
    assert.ok(res.body.errors.every((error) => !Object.hasOwn(error, 'value')))
  }
})

test('backend checks source deterministically with structured findings, severity summary and CRLF line numbers', async () => {
  const payload = { code: 'var total = 0\r\neval(input)\r\nelement.innerHTML = input\r\nif (total == 0) console.log(total)', language: 'javascript', file: 'sample.js' }
  const beforeCount = reviews.length
  const res = await analyze(payload)
  assert.equal(res.status, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(res.body.provider, 'deterministic')
  assert.deepEqual(res.body.summary, { Critical: 1, High: 1, Medium: 1, Low: 1, Info: 1 })
  assert.equal(res.body.findings.find((f) => f.severity === 'Critical').line, '2')
  for (const finding of res.body.findings) {
    assert.equal(finding.file, 'sample.js')
    for (const key of ['id', 'problem', 'explanation', 'improvement', 'suggestedCode', 'code']) assert.equal(typeof finding[key], 'string')
  }
  assert.deepEqual((await analyze(payload)).body, res.body)
  assert.equal(reviews.length, beforeCount, 'source checks do not persist submitted source')
})

test('TypeScript and clean source return accurate empty results; input is not executed', async () => {
  const res = await analyze({ code: 'const total: number = 0\nif (total === 0) {}\nthrow new Error("do not execute")', language: 'typescript' })
  assert.equal(res.status, 200)
  assert.equal(res.body.file, 'pasted-source.ts')
  assert.deepEqual(res.body.findings, [])
  assert.equal(res.body.total, 0)
  assert.equal(res.body.truncated, false)
})

test('boundary-sized input is accepted and findings are capped with explicit truncation', async () => {
  assert.equal((await analyze({ code: 'x'.repeat(50000), language: 'javascript' })).status, 200)
  const res = await analyze({ code: 'eval(x)\n'.repeat(201), language: 'javascript' })
  assert.equal(res.status, 200)
  assert.equal(res.body.findings.length, 200)
  assert.equal(res.body.total, 201)
  assert.equal(res.body.truncated, true)
  assert.equal(res.body.summary.Critical, 200)
})
