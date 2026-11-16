require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const config = require('../src/config')
const { inspectResponse, probe } = require('../scripts/diagnose-gemini')

test('diagnostic distinguishes Google-compatible JSON from intermediary-like HTML without exposing bodies', async () => {
  const json = await inspectResponse(new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'private error text' } }), { status: 404, headers: { 'content-type': 'application/json; charset=UTF-8' } }))
  assert.equal(json.responseFormat, 'google-compatible-json-error')
  assert.equal(json.googleErrorStatus, 'NOT_FOUND')
  const html = await inspectResponse(new Response('<html>private proxy error</html>', { status: 404, headers: { 'content-type': 'text/html' } }))
  assert.equal(html.responseFormat, 'non-json')
  assert.ok(!JSON.stringify([json, html]).includes('private'))
})

test('v1 probe uses same key and model with minimal body, without changing configuration', async () => {
  Object.assign(config, { geminiApiKey: 'test-secret', geminiModel: 'gemini-2.5-flash', geminiTimeoutMs: 1000 })
  const original = global.fetch
  global.fetch = async (url, opts) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent')
    assert.equal(opts.method, 'POST')
    assert.equal(opts.headers['x-goog-api-key'], 'test-secret')
    assert.deepEqual(Object.keys(JSON.parse(opts.body)), ['contents'])
    return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'private' } }), { status: 404, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await probe('v1', 'generate')
    assert.equal(result.category, 'google_not_found')
    assert.equal(result.httpStatus, 404)
    assert.ok(!JSON.stringify(result).includes('test-secret'))
    assert.equal(require('../src/services/gemini').API_VERSION, 'v1beta')
  } finally { global.fetch = original }
})
