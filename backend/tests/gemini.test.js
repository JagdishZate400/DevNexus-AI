require('./helpers/offline')
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')
const config = require('../src/config')
Object.assign(config, { aiProvider: 'gemini', geminiApiKey: 'test-key', geminiModel: 'test-model', geminiTimeoutMs: 1000 })
const gemini = require('../src/services/gemini')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const { conversations } = require('../src/db/memory')
let app, token
test('model parsing normalizes resource prefixes and surrounding quotes, rejects embedded invisible whitespace', () => {
  for (const value of ['gemini-2.5-flash', ' models/gemini-2.5-flash ', '"models/gemini-2.5-flash"']) {
    const result = config.parseGeminiModel(value)
    assert.equal(result.model, 'gemini-2.5-flash')
    assert.equal(result.valid, true)
  }
  assert.equal(config.parseGeminiModel('gemini-2.5-\u200bflash').valid, false)
})

test('diagnostic captures exact HTTP status without sensitive data and minimal request omits system instruction', async () => {
  const reports = []
  await withFetch(async (url, options) => {
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.equal(JSON.parse(options.body).systemInstruction, undefined)
    return new Response('private provider body', { status: 404 })
  }, async () => {
    await assert.rejects(gemini.generateContent({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }] }], diagnostic: data => reports.push(data) }),
      err => err.code === 'ai_model_unavailable' && err.message.includes('HTTP 404'))
  })
  assert.equal(reports.length, 1)
  assert.equal(reports[0].httpStatus, 404)
  assert.equal(reports[0].category, 'ai_model_unavailable')
  assert.equal(reports[0].diagnosticCategory, 'http_404')
  assert.ok(reports[0].requestBytes > 0)
  assert.ok(!JSON.stringify(reports).includes('private'))
  assert.ok(!JSON.stringify(reports).includes('test-key'))
})
before(async () => {
  const repository = createTestRepository()
  const user = { id: require('crypto').randomUUID(), email: 'gemini@example.com', role: 'Developer', tokenVersion: 0 }
  await repository.createUser(user)
  app = createApp({ userRepository: repository })
  token = signToken(user)
})

async function withFetch(handler, run) {
  const original = global.fetch
  global.fetch = handler
  try { await run() } finally { global.fetch = original }
}
test('per-call correction timeout can shrink but never extend configured Gemini timeout',async()=>{
  let calls=0
  await withFetch(async(_,options)=>{calls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))))},async()=>{
    await assert.rejects(gemini.generateContent({contents:[],timeoutMs:5}),e=>e.code==='ai_timeout')
    for(const timeoutMs of [0,-1,1.5,config.geminiTimeoutMs+1]) await assert.rejects(gemini.generateContent({contents:[],timeoutMs}),e=>e.code==='ai_configuration')
  })
  assert.equal(calls,1)
})
function response(text, extra = {}) {
  return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], ...extra }))
}
function post(path, body) { return request(app).post(path).set('Authorization', `Bearer ${token}`).send(body) }
const finding = { severity: 'High', line: 1, category: 'Security', problem: 'Untrusted evaluation.', explanation: 'Input may execute code.', improvement: 'Use a parser.', suggestedCode: '' }

test('Gemini chat preserves contract, sends header key and bounded history without repository claims', async () => {
  await withFetch(async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent')
    assert.equal(options.headers['x-goog-api-key'], 'test-key')
    assert.ok(!url.includes('test-key'))
    const body = JSON.parse(options.body)
    assert.equal(body.contents.length, 11)
    assert.equal(body.contents[9].role, 'model')
    assert.equal(body.contents[0].parts[0].text.length, 4000)
    assert.equal(body.contents[10].parts[0].text, 'hello')
    assert.equal(body.tools, undefined)
    return response('Hello')
  }, async () => {
    const result = await gemini.generateReply({ message: 'hello', history: Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(5000) })) })
    assert.deepEqual(result, { reply: 'Hello', sources: [], provider: 'gemini', model: 'test-model' })
  })
})

test('authenticated ask and conversation messages commit only after success', async () => {
  await withFetch(async () => response('Answer'), async () => {
    const result = await post('/api/ai/ask', { message: 'hello' })
    assert.equal(result.status, 201)
    assert.equal(result.body.assistantMessage.provider, 'gemini')
    const id = result.body.conversation.id
    await withFetch(async () => new Response('secret upstream body', { status: 503 }), async () => {
      const failed = await post(`/api/ai/conversations/${id}/messages`, { message: 'retry' })
      assert.equal(failed.status, 503)
      assert.equal(failed.body.code, 'ai_unavailable')
      assert.equal(conversations.find((c) => c.id === id).messages.length, 2)
      const count = conversations.length
      assert.equal((await post('/api/ai/ask', { message: 'failure' })).status, 503)
      assert.equal(conversations.length, count)
    })
    const retry = await post(`/api/ai/conversations/${id}/messages`, { message: 'retry' })
    assert.equal(retry.body.conversation.messages.length, 4)
    assert.equal(retry.body.conversation.messages.filter((m) => m.content === 'retry').length, 1)
  })
})

test('source review sends actual source, validates findings and preserves response contract', async () => {
  await withFetch(async (_, options) => {
    const body = JSON.parse(options.body)
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), { language: 'javascript', file: 'actual.js', source: 'eval(input)' })
    assert.equal(body.generationConfig.responseMimeType, 'application/json')
    return response(JSON.stringify({ findings: [finding] }))
  }, async () => {
    const result = await post('/api/reviews/analyze', { code: 'eval(input)', language: 'javascript', file: 'actual.js' })
    assert.equal(result.status, 200)
    assert.equal(result.body.provider, 'gemini')
    assert.equal(result.body.findings[0].file, 'actual.js')
    assert.equal(result.body.findings[0].line, '1')
    assert.equal(result.body.findings[0].code, 'eval(input)')
    assert.equal(result.body.summary.High, 1)
    assert.equal(result.body.total, 1)
    assert.equal(result.body.truncated, false)
  })
})

test('clean source accepts zero findings and explicit deterministic mode never calls Gemini', async () => {
  await withFetch(async () => response('{"findings":[]}'), async () => {
    const result = await post('/api/reviews/analyze', { code: 'const x = 1;', language: 'typescript' })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.findings, [])
    assert.equal(result.body.total, 0)
  })
  await withFetch(async () => { throw new Error('must not call') }, async () => {
    const result = await post('/api/reviews/analyze', { code: 'eval(input)', language: 'javascript', mode: 'deterministic' })
    assert.equal(result.status, 200)
    assert.equal(result.body.provider, 'deterministic')
    assert.equal(result.body.findings.length, 1)
  })
})

test('malformed JSON, wrong paths, out-of-range lines and invalid fields fail safely', async () => {
  for (const text of ['not json', '{}', JSON.stringify({ findings: [{ ...finding, line: 2 }] }), JSON.stringify({ findings: [{ ...finding, file: 'invented.js' }] }), JSON.stringify({ findings: [{ ...finding, severity: 'Bogus' }] })]) {
    await withFetch(async () => response(text), async () => {
      const result = await post('/api/reviews/analyze', { code: 'x', language: 'javascript' })
      assert.equal(result.status, 502)
      assert.equal(result.body.code, 'ai_malformed_response')
      assert.equal(result.body.findings, undefined)
    })
  }
})

test('upstream errors are sanitized with no mock results', async () => {
  for (const [status, code, expected] of [[400, 'ai_request_rejected', 503], [401, 'ai_authentication', 503], [403, 'ai_authentication', 503], [404, 'ai_model_unavailable', 503], [429, 'ai_quota', 429], [500, 'ai_unavailable', 503]]) {
    await withFetch(async () => new Response('private-key raw provider details', { status }), async () => {
      const result = await post('/api/ai/ask', { message: 'hello' })
      assert.equal(result.status, expected)
      assert.equal(result.body.code, code)
      assert.ok(!JSON.stringify(result.body).includes('private-key'))
      assert.equal(result.body.assistantMessage, undefined)
    })
  }
})

test('blocked, empty, invalid response bodies and truncated output fail clearly', async () => {
  for (const [handler, code] of [
    [() => response('', { promptFeedback: { blockReason: 'SAFETY' } }), 'ai_blocked'],
    [() => response(''), 'ai_malformed_response'],
    [() => new Response('invalid JSON'), 'ai_malformed_response'],
    [() => response('partial', { candidates: [{ finishReason: 'MAX_TOKENS' }] }), 'ai_output_limit'],
  ]) await withFetch(async () => handler(), async () => {
    await assert.rejects(gemini.generateReply({ message: 'hi' }), (err) => err.code === code)
  })
})

test('AbortController timeout is sanitized and does not commit chat messages', async () => {
  await withFetch((_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('private network details')), { once: true })
  }), async () => {
    const count = conversations.length
    const result = await post('/api/ai/ask', { message: 'hello' })
    assert.equal(result.status, 504)
    assert.equal(result.body.code, 'ai_timeout')
    assert.equal(conversations.length, count)
  })
})

test('Gemini configuration is required and project-only reviews do not invent findings', async () => {
  const model = config.geminiModel
  config.geminiModel = ''
  try { await assert.rejects(gemini.generateReply({ message: 'hello' }), (err) => err.code === 'ai_configuration') }
  finally { config.geminiModel = model }
  assert.equal((await post('/api/reviews', { project: 'P' })).body.code, 'source_required')
  assert.equal((await request(app).post('/api/reviews/analyze').send({ code: 'x', language: 'javascript' })).status, 401)
  assert.equal(require('../src/services/ai').hasLlm(), false, 'Gemini does not activate documentation provider')
})

test('production errors retain safe messages and oversized provider bodies fail', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    await withFetch(async () => new Response('private raw error', { status: 401 }), async () => {
      const result = await post('/api/ai/ask', { message: 'hello' })
      assert.equal(result.body.message, 'Gemini API key is invalid or lacks access.')
      assert.ok(!JSON.stringify(result.body).includes('private'))
    })
  } finally { process.env.NODE_ENV = previous }
  await withFetch(async () => new Response('x'.repeat(256001)), async () => {
    await assert.rejects(gemini.generateReply({ message: 'hello' }), (err) => err.code === 'ai_malformed_response')
  })
})
