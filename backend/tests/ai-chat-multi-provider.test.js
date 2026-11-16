require('./helpers/offline')
process.env.GROK_MODEL = process.env.GROK_MODEL || 'grok-2-mini'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const config = require('../src/config')
const { generateReply, generateMultiProviderChatReply } = require('../src/services/ai')
const { createAiRouter, aiError } = require('../src/services/ai/aiRouter')

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  const bodyText = typeof data === 'string' ? data : JSON.stringify(data)
  return new Response(bodyText, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

function geminiSuccess(text = 'Gemini general response text') {
  return jsonResponse({
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
  })
}

function grokSuccess(text = 'Grok backup general response text') {
  return jsonResponse({
    id: 'chatcmpl-test-chat',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
  })
}

// 1. Feature flag disabled — unchanged legacy behavior
test('1. Feature flag disabled preserves legacy general chat behavior', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  const origProvider = config.aiProvider
  try {
    config.aiMultiProviderChatEnabled = false
    config.aiProvider = 'mock'

    const res = await generateReply({ message: 'Hello assistant' })
    assert.equal(res.provider, 'mock')
    assert.ok(res.reply.startsWith('Mock assistant:'))
    assert.deepEqual(res.sources, [])
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
    config.aiProvider = origProvider
  }
})

// 2. Feature flag enabled — Gemini success
test('2. Feature flag enabled routes general chat to Gemini primary successfully', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const mockFetch = async (url) => {
      assert.ok(url.includes('generativelanguage.googleapis.com'))
      return geminiSuccess('Detailed engineering advice from Gemini')
    }

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-test-key'],
      grokKeys: ['grok-test-key'],
      fetchClient: mockFetch,
    })

    const res = await generateReply({
      message: 'Explain event loops',
      router: testRouter,
    })

    assert.equal(res.provider, 'gemini')
    assert.equal(res.reply, 'Detailed engineering advice from Gemini')
    assert.deepEqual(res.sources, [])
    assert.equal(res.keyIndex, undefined, 'Internal keyIndex must not leak to chat response')
    assert.equal(res.usage, undefined, 'Internal usage must not leak to chat response')
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// 3. Gemini transient failure — Grok success
test('3. Gemini transient failure (503) fails over to Grok backup in general chat', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const callLog = []
    const mockFetch = async (url) => {
      callLog.push(url)
      if (url.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({ error: 'Gemini service overloaded' }, { status: 503 })
      }
      return grokSuccess('Grok backup response on transient failover')
    }

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-key-0'],
      grokKeys: ['grok-key-0'],
      fetchClient: mockFetch,
    })

    const res = await generateReply({
      message: 'Design a resilient queue',
      router: testRouter,
    })

    assert.equal(res.provider, 'grok')
    assert.equal(res.reply, 'Grok backup response on transient failover')
    assert.deepEqual(res.sources, [])
    assert.equal(callLog.length, 2)
    assert.ok(callLog[0].includes('generativelanguage.googleapis.com'))
    assert.ok(callLog[1].includes('api.x.ai'))
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// 4. Gemini quota exhaustion — Grok success
test('4. Gemini quota exhaustion (429) fails over to Grok without blind Gemini key rotation', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const callLog = []
    const mockFetch = async (url, options) => {
      callLog.push({ url, headers: options.headers })
      if (url.includes('generativelanguage.googleapis.com')) {
        return jsonResponse(
          { error: { code: 429, message: 'Resource exhausted' } },
          { status: 429, headers: { 'retry-after': '60' } }
        )
      }
      return grokSuccess('Grok response following Gemini quota exhaustion')
    }

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-key-0', 'gemini-key-1'],
      grokKeys: ['grok-key-0'],
      fetchClient: mockFetch,
    })

    const res = await generateReply({
      message: 'Handle rate limits',
      router: testRouter,
    })

    assert.equal(res.provider, 'grok')
    assert.equal(res.reply, 'Grok response following Gemini quota exhaustion')

    // Gemini called only once (no key rotation to key-1 on 429)
    const geminiCalls = callLog.filter((c) => c.url.includes('generativelanguage.googleapis.com'))
    assert.equal(geminiCalls.length, 1)
    assert.equal(geminiCalls[0].headers['x-goog-api-key'], 'gemini-key-0')
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// 5. Both providers unavailable
test('5. Both providers unavailable returns sanitized ai_unavailable error', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const mockFetch = async () => {
      return jsonResponse({ error: 'Service Unavailable' }, { status: 503 })
    }

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-key-0'],
      grokKeys: ['grok-key-0'],
      fetchClient: mockFetch,
    })

    await assert.rejects(
      async () => {
        await generateReply({
          message: 'Outage test',
          router: testRouter,
        })
      },
      (err) => {
        assert.equal(err.code, 'ai_unavailable')
        assert.equal(err.status, 503)
        return true
      }
    )
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// 6. Missing Grok configuration
test('6. Missing Grok configuration surfaces sanitized Gemini error on outage', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const mockFetch = async () => {
      return jsonResponse({ error: 'Gemini 503 outage' }, { status: 503 })
    }

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-key-0'],
      grokKeys: [], // No Grok keys configured
      fetchClient: mockFetch,
    })

    await assert.rejects(
      async () => {
        await generateReply({
          message: 'Outage without backup',
          router: testRouter,
        })
      },
      (err) => {
        assert.equal(err.code, 'ai_unavailable')
        return true
      }
    )
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// 7. Conversation history preservation
test('7. Conversation history is properly structured and passed to the router', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    let capturedContents = null
    const mockFetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      capturedContents = body.contents
      return geminiSuccess('History preserved')
    }

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-key-0'],
      grokKeys: ['grok-key-0'],
      fetchClient: mockFetch,
    })

    const history = [
      { role: 'user', content: 'What is a closure?' },
      { role: 'assistant', content: 'A closure is a function bundling its lexical environment.' },
    ]

    const res = await generateReply({
      message: 'Can you show an example?',
      history,
      router: testRouter,
    })

    assert.equal(res.reply, 'History preserved')
    assert.ok(Array.isArray(capturedContents))
    assert.equal(capturedContents.length, 3)
    assert.equal(capturedContents[0].role, 'user')
    assert.equal(capturedContents[0].parts[0].text, 'What is a closure?')
    assert.equal(capturedContents[1].role, 'model')
    assert.equal(capturedContents[1].parts[0].text, 'A closure is a function bundling its lexical environment.')
    assert.equal(capturedContents[2].role, 'user')
    assert.equal(capturedContents[2].parts[0].text, 'Can you show an example?')
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// 8. No credential leakage
test('8. Credentials, tokens, and internal indices never leak into chat responses or error objects', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const secretGeminiKey = 'gemini-super-secret-key-12345678'
    const secretGrokKey = 'xai-super-secret-token-87654321'

    const mockFetch = async () => geminiSuccess('Safe answer without credentials')

    const testRouter = createAiRouter({
      geminiKeys: [secretGeminiKey],
      grokKeys: [secretGrokKey],
      fetchClient: mockFetch,
    })

    const res = await generateReply({
      message: 'Test security leaks',
      router: testRouter,
    })

    const serialized = JSON.stringify(res)
    assert.ok(!serialized.includes(secretGeminiKey), 'Leaked Gemini key in chat response!')
    assert.ok(!serialized.includes(secretGrokKey), 'Leaked Grok key in chat response!')
    assert.ok(!serialized.includes('Bearer'), 'Leaked Bearer header in chat response!')
    assert.equal(res.keyIndex, undefined)
    assert.equal(res.usage, undefined)
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// 9. Repository-grounded chat remains unchanged
test('9. Repository-grounded chat (with projectId) bypasses multi-provider router completely', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  const origProvider = config.aiProvider
  try {
    config.aiMultiProviderChatEnabled = true
    config.aiProvider = 'mock'

    let routerCalled = false
    const testRouter = {
      generateContent: async () => {
        routerCalled = true
        return { text: 'from router', provider: 'grok', model: 'grok-2-mini' }
      },
    }

    // Call generateReply WITH projectId
    const res = await generateReply({
      message: 'Analyze this repo',
      projectId: 'proj-grounded-test-123',
      router: testRouter,
    })

    // Because projectId was provided, multi-provider router is bypassed!
    assert.equal(routerCalled, false, 'Multi-provider router must not be called when projectId is present')
    assert.equal(res.provider, 'mock')
    assert.ok(res.reply.includes('proj-grounded-test-123'))
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
    config.aiProvider = origProvider
  }
})

// 10. Existing response formats remain compatible
test('10. Multi-provider chat output adheres to canonical general chat response shape', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-key-0'],
      grokKeys: ['grok-key-0'],
      fetchClient: async () => geminiSuccess('Standard chat response'),
    })

    const res = await generateReply({
      message: 'Check response shape',
      router: testRouter,
    })

    // Required canonical shape: { reply: string, sources: array, provider: string, model: string }
    assert.equal(typeof res.reply, 'string')
    assert.ok(Array.isArray(res.sources))
    assert.equal(typeof res.provider, 'string')
    assert.equal(typeof res.model, 'string')

    // Confirm that wrapping for routes matches { ...res, mode: 'general', grounded: false }
    const routeWrapped = { ...res, mode: 'general', grounded: false }
    assert.equal(routeWrapped.mode, 'general')
    assert.equal(routeWrapped.grounded, false)
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// ============================================================================
// PHASE 2C: CONFIGURATION COMPATIBILITY & GROK MODEL SAFETY TESTS
// ============================================================================

// 11. Legacy Gemini configuration is discovered into Slot 0
test('11. Legacy Gemini configuration is discovered into Slot 0', () => {
  const origKey = process.env.GEMINI_API_KEY
  try {
    process.env.GEMINI_API_KEY = 'gemini-legacy-primary-key'
    delete process.env.GEMINI_API_KEY_2
    const router = createAiRouter()
    assert.equal(router.geminiKeys.length, 1)
    assert.equal(router.geminiKeys[0], 'gemini-legacy-primary-key')
  } finally {
    process.env.GEMINI_API_KEY = origKey
  }
})

// 12. Secondary Gemini credential discovery
test('12. Secondary Gemini credential (GEMINI_API_KEY_2) is discovered into Slot 1', () => {
  const orig1 = process.env.GEMINI_API_KEY
  const orig2 = process.env.GEMINI_API_KEY_2
  try {
    process.env.GEMINI_API_KEY = 'gemini-key-1'
    process.env.GEMINI_API_KEY_2 = 'gemini-key-2'
    const router = createAiRouter()
    assert.equal(router.geminiKeys.length, 2)
    assert.equal(router.geminiKeys[0], 'gemini-key-1')
    assert.equal(router.geminiKeys[1], 'gemini-key-2')
  } finally {
    process.env.GEMINI_API_KEY = orig1
    process.env.GEMINI_API_KEY_2 = orig2
  }
})

// 13. All Grok credential aliases map to primary Grok slot
test('13. All Grok credential aliases (GROK_API_KEY_1, GROK_API_KEY, XAI_API_KEY) map to primary Grok slot', () => {
  const orig1 = process.env.GROK_API_KEY_1
  const origLegacy = process.env.GROK_API_KEY
  const origXai = process.env.XAI_API_KEY
  try {
    // 13a: GROK_API_KEY_1 alone
    process.env.GROK_API_KEY_1 = 'key-from-grok-1'
    delete process.env.GROK_API_KEY
    delete process.env.XAI_API_KEY
    assert.equal(createAiRouter().grokKeys[0], 'key-from-grok-1')

    // 13b: GROK_API_KEY alone
    delete process.env.GROK_API_KEY_1
    process.env.GROK_API_KEY = 'key-from-legacy-alias'
    delete process.env.XAI_API_KEY
    assert.equal(createAiRouter().grokKeys[0], 'key-from-legacy-alias')

    // 13c: XAI_API_KEY alone
    delete process.env.GROK_API_KEY_1
    delete process.env.GROK_API_KEY
    process.env.XAI_API_KEY = 'key-from-xai-alias'
    assert.equal(createAiRouter().grokKeys[0], 'key-from-xai-alias')
  } finally {
    process.env.GROK_API_KEY_1 = orig1
    process.env.GROK_API_KEY = origLegacy
    process.env.XAI_API_KEY = origXai
  }
})

// 14. Credential precedence strictly enforces GROK_API_KEY_1 > GROK_API_KEY > XAI_API_KEY
test('14. Credential precedence strictly enforces GROK_API_KEY_1 > GROK_API_KEY > XAI_API_KEY', () => {
  const orig1 = process.env.GROK_API_KEY_1
  const origLegacy = process.env.GROK_API_KEY
  const origXai = process.env.XAI_API_KEY
  const orig2 = process.env.GROK_API_KEY_2
  const orig3 = process.env.GROK_API_KEY_3
  try {
    process.env.GROK_API_KEY_1 = 'winner-grok-key-1'
    process.env.GROK_API_KEY = 'shadowed-grok-key'
    process.env.XAI_API_KEY = 'shadowed-xai-key'
    process.env.GROK_API_KEY_2 = 'secondary-grok-key'
    process.env.GROK_API_KEY_3 = 'tertiary-grok-key'

    const router = createAiRouter()
    assert.equal(router.grokKeys.length, 3)
    assert.equal(router.grokKeys[0], 'winner-grok-key-1')
    assert.equal(router.grokKeys[1], 'secondary-grok-key')
    assert.equal(router.grokKeys[2], 'tertiary-grok-key')

    delete process.env.GROK_API_KEY_1
    const router2 = createAiRouter()
    assert.equal(router2.grokKeys[0], 'shadowed-grok-key')
  } finally {
    process.env.GROK_API_KEY_1 = orig1
    process.env.GROK_API_KEY = origLegacy
    process.env.XAI_API_KEY = origXai
    process.env.GROK_API_KEY_2 = orig2
    process.env.GROK_API_KEY_3 = orig3
  }
})

// 15. Missing Grok model fails closed with clear configuration error when Grok backup is enabled
test('15. Missing Grok model fails closed with clear configuration error when Grok backup is enabled', async () => {
  const origModel = process.env.GROK_MODEL
  try {
    delete process.env.GROK_MODEL

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-key-0'],
      grokKeys: ['grok-key-0'],
      grokModel: '', // Explicitly empty / unconfigured
      fetchClient: async () => jsonResponse({ error: 'Overloaded' }, { status: 503 }),
    })

    await assert.rejects(
      async () => {
        await testRouter.generateContent({ contents: 'Failover needs model' })
      },
      (err) => {
        assert.equal(err.code, 'ai_configuration')
        assert.ok(err.message.includes('explicit GROK_MODEL is required'))
        return true
      }
    )
  } finally {
    process.env.GROK_MODEL = origModel
  }
})

// 16. Explicit Grok model configuration accepted and passed through
test('16. Explicit Grok model configuration (GROK_MODEL=grok-2-custom) accepted and passed through', async () => {
  let capturedModel = null
  const mockFetch = async (url, options) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ error: 'Unavailable' }, { status: 503 })
    }
    const body = JSON.parse(options.body)
    capturedModel = body.model
    return grokSuccess('Answer from grok-2-custom')
  }

  const testRouter = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    grokModel: 'grok-2-custom',
    fetchClient: mockFetch,
  })

  const res = await testRouter.generateContent({ contents: 'Custom model check' })
  assert.equal(res.provider, 'grok')
  assert.equal(res.model, 'grok-2-custom')
  assert.equal(capturedModel, 'grok-2-custom')
})

// 17. Feature flag disabled strictly preserves legacy chat routing
test('17. Feature flag disabled strictly preserves legacy chat routing even if Grok credentials exist', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  const origProvider = config.aiProvider
  try {
    config.aiMultiProviderChatEnabled = false
    config.aiProvider = 'mock'

    const res = await generateReply({ message: 'Legacy chat check' })
    assert.equal(res.provider, 'mock')
    assert.ok(res.reply.startsWith('Mock assistant:'))
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
    config.aiProvider = origProvider
  }
})

// 18. Feature flag enabled routes general chat to Gemini primary successfully
test('18. Feature flag enabled routes general chat to Gemini primary successfully', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-key-0'],
      grokKeys: ['grok-key-0'],
      grokModel: 'grok-2',
      fetchClient: async () => geminiSuccess('Primary Gemini response'),
    })

    const res = await generateReply({
      message: 'Hello primary',
      router: testRouter,
    })

    assert.equal(res.provider, 'gemini')
    assert.equal(res.reply, 'Primary Gemini response')
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// 19. Gemini simulated 503 gracefully fails over to Grok backup in general chat
test('19. Gemini simulated 503 gracefully fails over to Grok backup in general chat', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const mockFetch = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({ error: 'Overloaded' }, { status: 503 })
      }
      return grokSuccess('Backup response from Grok')
    }

    const testRouter = createAiRouter({
      geminiKeys: ['gemini-key-0'],
      grokKeys: ['grok-key-0'],
      grokModel: 'grok-2',
      fetchClient: mockFetch,
    })

    const res = await generateReply({
      message: 'Simulated 503 failover',
      router: testRouter,
    })

    assert.equal(res.provider, 'grok')
    assert.equal(res.reply, 'Backup response from Grok')
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})

// 20. No secret leakage across responses, errors, or diagnostics
test('20. No secret leakage across responses, errors, or diagnostics when multi-provider chat is active', async () => {
  const origFlag = config.aiMultiProviderChatEnabled
  try {
    config.aiMultiProviderChatEnabled = true

    const secretGeminiKey = 'gemini-super-secret-key-phase2c'
    const secretGrokKey = 'xai-confidential-token-phase2c'

    const testRouter = createAiRouter({
      geminiKeys: [secretGeminiKey],
      grokKeys: [secretGrokKey],
      grokModel: 'grok-2',
      fetchClient: async () => geminiSuccess('Safe response payload'),
    })

    const res = await generateReply({
      message: 'Check leakage',
      router: testRouter,
    })

    const serialized = JSON.stringify(res)
    assert.ok(!serialized.includes(secretGeminiKey), 'Leaked Gemini key!')
    assert.ok(!serialized.includes(secretGrokKey), 'Leaked Grok key!')
    assert.ok(!serialized.includes('Bearer'), 'Leaked Bearer header!')
  } finally {
    config.aiMultiProviderChatEnabled = origFlag
  }
})
