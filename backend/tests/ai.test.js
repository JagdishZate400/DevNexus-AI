require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-chars-long!!'

// Fresh service instance per env variant (config reads env at load).
function freshAi(env) {
  for (const key of ['AI_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_TIMEOUT_MS', 'AI_SERVICE_URL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_TIMEOUT_MS']) {
    delete process.env[key]
  }
  Object.assign(process.env, env)
  delete require.cache[require.resolve('../src/config')]
  delete require.cache[require.resolve('../src/services/ai')]
  return require('../src/services/ai')
}

function stubFetch(handler) {
  const original = global.fetch
  global.fetch = handler
  return () => {
    global.fetch = original
  }
}

test('no upstream configured → offline mock', async () => {
  const ai = freshAi({})
  const restore = stubFetch(async () => {
    throw new Error('fetch must not be called without an upstream')
  })
  try {
    const res = await ai.generateReply({ message: 'hello', projectId: 'workspace', history: [] })
    assert.equal(res.provider, 'mock')
    assert.ok(res.reply.length > 0)
    assert.equal(ai.getProvider(), 'mock')
  } finally {
    restore()
  }
})

test('openrouter key → chat completions call with auth + model', async () => {
  const ai = freshAi({ OPENROUTER_API_KEY: 'sk-or-test-key', OPENROUTER_MODEL: 'openai/gpt-4o-mini' })
  let seen = null
  const restore = stubFetch(async (url, opts) => {
    seen = { url, opts, body: JSON.parse(opts.body) }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '  Real answer from model  ' } }] }),
    }
  })
  try {
    const res = await ai.generateReply({
      message: 'How do I run tests?',
      projectId: 'workspace',
      history: [{ role: 'user', content: 'How do I run tests?' }],
    })
    assert.equal(res.provider, 'openrouter')
    assert.equal(res.reply, 'Real answer from model')
    assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(seen.opts.headers.Authorization, 'Bearer sk-or-test-key')
    assert.equal(seen.body.model, 'openai/gpt-4o-mini')
    // History tail duplicating the message is sent exactly once.
    const userMsgs = seen.body.messages.filter((m) => m.role === 'user')
    assert.equal(userMsgs.length, 1)
    assert.ok(seen.body.messages[0].role === 'system')
    assert.equal(ai.getProvider(), 'openrouter')
  } finally {
    restore()
  }
})

test('openrouter outage → mock fallback with notice (chat never 500s)', async () => {
  const ai = freshAi({ OPENROUTER_API_KEY: 'sk-or-test-key' })
  const restore = stubFetch(async () => ({ ok: false, status: 401, text: async () => 'invalid key' }))
  try {
    const res = await ai.generateReply({ message: 'hi', history: [] })
    assert.equal(res.provider, 'mock-fallback')
    assert.match(res.notice || '', /401/)
  } finally {
    restore()
  }
})

test('review findings parse model JSON, capped and defaulted', async () => {
  const ai = freshAi({ OPENROUTER_API_KEY: 'sk-or-test-key' })
  const restore = stubFetch(async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              findings: [
                { severity: 'High', file: 'a.js', line: '3', category: 'Bugs', problem: 'p', improvement: 'f', code: 'x' },
                { severity: 'Bogus', file: 'b.js', problem: 'p2' },
              ],
            }),
          },
        },
      ],
    }),
  }))
  try {
    const findings = await ai.generateReviewFindings({ project: 'P', projectId: 'workspace', scope: 'all', focus: 'Bugs' })
    assert.equal(findings.length, 2)
    assert.equal(findings[0].severity, 'High')
    assert.equal(findings[1].severity, 'Medium') // invalid severity defaults
    assert.ok(findings.every((f) => f.id && f.status === 'Open'))
  } finally {
    restore()
  }
})

test('review findings throw on garbage JSON (route falls back)', async () => {
  const ai = freshAi({ OPENROUTER_API_KEY: 'sk-or-test-key' })
  const restore = stubFetch(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
  }))
  try {
    await assert.rejects(() => ai.generateReviewFindings({ project: 'P', projectId: 'w', scope: 's', focus: 'f' }))
  } finally {
    restore()
  }
})

test('document generation returns model markdown', async () => {
  const ai = freshAi({ OPENROUTER_API_KEY: 'sk-or-test-key' })
  const restore = stubFetch(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '# Real Doc\n\nBody' } }] }),
  }))
  try {
    const content = await ai.generateDocumentContent({ type: 'readme', project: 'P', projectId: 'workspace' })
    assert.equal(content, '# Real Doc\n\nBody')
  } finally {
    restore()
  }
})

test('chat system prompt carries live workspace context', async () => {
  const ai = freshAi({ OPENROUTER_API_KEY: 'sk-or-test-key' })
  let seen = null
  const restore = stubFetch(async (url, opts) => {
    seen = JSON.parse(opts.body)
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
  })
  try {
    await ai.generateReply({ message: 'summarize', projectId: 'workspace', history: [] })
    const system = seen.messages[0].content
    assert.match(system, /Live workspace context/)
    assert.match(system, /Open tasks:/)
  } finally {
    restore()
  }
})
test('fastapi service wins when both upstreams set', async () => {
  const ai = freshAi({ AI_SERVICE_URL: 'http://rag:8000', OPENROUTER_API_KEY: 'sk-or-test-key' })
  const restore = stubFetch(async (url) => {
    assert.match(String(url), /^http:\/\/rag:8000/)
    return { ok: true, json: async () => ({ reply: 'from rag', sources: [] }) }
  })
  try {
    const res = await ai.generateReply({ message: 'hi', history: [] })
    assert.equal(res.provider, 'ai-service')
    assert.equal(res.reply, 'from rag')
    assert.equal(ai.getProvider(), 'ai-service')
  } finally {
    restore()
  }
})
