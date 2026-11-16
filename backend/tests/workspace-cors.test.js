require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { parseOrigins } = require('../src/config')

test('Vite 5174 development origin passes login and authenticated Workspace preflights', async () => {
  const app = createApp({ userRepository: createTestRepository() })
  for (const [path, method, headers] of [['/api/auth/login', 'POST', 'content-type'], ['/api/workspace/projects', 'GET', 'authorization,content-type']]) {
    const res = await request(app).options(path).set('Origin', 'http://localhost:5174').set('Access-Control-Request-Method', method).set('Access-Control-Request-Headers', headers)
    assert.equal(res.status, 204)
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5174')
  }
  const denied = await request(app).options('/api/auth/login').set('Origin', 'https://untrusted.example').set('Access-Control-Request-Method', 'POST')
  assert.equal(denied.status, 403)
  assert.equal(denied.headers['access-control-allow-origin'], undefined)
  assert.equal((await request(app).get('/api/workspace/projects').set('Origin', 'http://localhost:5174')).status, 401)
})

test('production CORS retains explicit allowlist; development adds only exact localhost:5174', () => {
  assert.deepEqual(parseOrigins('https://app.example', '', true), ['https://app.example'])
  assert.deepEqual(parseOrigins('http://localhost:5173', '', false), ['http://localhost:5173', 'http://localhost:5174'])
  assert.ok(!parseOrigins('http://localhost:5173', '', false).includes('http://localhost:5175'))
})
