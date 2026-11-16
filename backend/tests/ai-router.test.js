require('./helpers/offline')
process.env.GROK_MODEL = 'grok-2-mini'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  createAiRouter,
  AiRouter,
  aiError,
  safeDiagnostic,
} = require('../src/services/ai/aiRouter')
const geminiService = require('../src/services/gemini')
const grokAdapter = require('../src/services/ai/grokAdapter')

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

function geminiSuccess(text = 'Gemini response text', usage = { promptTokenCount: 12, candidatesTokenCount: 24, totalTokenCount: 36 }) {
  return jsonResponse({
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: usage,
  })
}

function grokSuccess(text = 'Grok backup text', usage = { prompt_tokens: 15, completion_tokens: 20, total_tokens: 35 }) {
  return jsonResponse({
    id: 'chatcmpl-grok-test',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage,
  })
}

// 1. Gemini primary success
test('1. Gemini primary success routes to Gemini key 0 and returns normalized contract', async () => {
  const callLog = []
  const mockFetch = async (url, options) => {
    callLog.push({ url, headers: options.headers })
    return geminiSuccess('Architectural pattern analysis completed.')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0', 'gemini-key-1'],
    grokKeys: ['grok-key-0', 'grok-key-1', 'grok-key-2'],
    geminiModel: 'gemini-1.5-flash',
    fetchClient: mockFetch,
  })

  const res = await router.generateContent({
    contents: [{ role: 'user', content: 'Analyze architecture' }],
  })

  assert.equal(res.provider, 'gemini')
  assert.equal(res.keyIndex, 0)
  assert.equal(res.model, 'gemini-1.5-flash')
  assert.equal(res.text, 'Architectural pattern analysis completed.')
  assert.deepEqual(res.usage, {
    promptTokens: 12,
    completionTokens: 24,
    totalTokens: 36,
  })

  assert.equal(callLog.length, 1)
  assert.equal(callLog[0].headers['x-goog-api-key'], 'gemini-key-0')
  assert.ok(callLog[0].url.includes('gemini-1.5-flash'))
})

// 2. Gemini credential-specific authentication failure (401/403)
test('2. Gemini credential-specific 401 failure rotates to Gemini key 1 and succeeds without Grok', async () => {
  const callLog = []
  const mockFetch = async (url, options) => {
    const key = options.headers['x-goog-api-key']
    callLog.push({ url, key })
    if (key === 'gemini-bad-key-0') {
      return jsonResponse({ error: { code: 401, message: 'API key expired' } }, { status: 401 })
    }
    return geminiSuccess('Success with Gemini key 1')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-bad-key-0', 'gemini-good-key-1'],
    grokKeys: ['grok-key-0', 'grok-key-1'],
    fetchClient: mockFetch,
  })

  const res = await router.generateContent({
    contents: 'Check credentials',
  })

  assert.equal(res.provider, 'gemini')
  assert.equal(res.keyIndex, 1)
  assert.equal(res.text, 'Success with Gemini key 1')
  assert.equal(callLog.length, 2)
  assert.equal(callLog[0].key, 'gemini-bad-key-0')
  assert.equal(callLog[1].key, 'gemini-good-key-1')
})

// 3. Gemini shared quota 429 -> Grok without blind Gemini key rotation
test('3. Gemini shared quota 429 fails over to Grok without rotating to Gemini key 1', async () => {
  const callLog = []
  const mockFetch = async (url, options) => {
    callLog.push({ url, headers: options.headers })
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse(
        { error: { code: 429, message: 'Resource exhausted' } },
        { status: 429, headers: { 'retry-after': '30' } }
      )
    }
    return grokSuccess('Answer from Grok backup')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0', 'gemini-key-1'],
    grokKeys: ['grok-key-0', 'grok-key-1', 'grok-key-2'],
    fetchClient: mockFetch,
  })

  const res = await router.generateContent({
    contents: 'Explain failover behavior',
  })

  assert.equal(res.provider, 'grok')
  assert.equal(res.keyIndex, 0)
  assert.equal(res.text, 'Answer from Grok backup')

  // Gemini should only have been called once with key-0; NO call to key-1!
  const geminiCalls = callLog.filter((c) => c.url.includes('generativelanguage.googleapis.com'))
  const grokCalls = callLog.filter((c) => c.url.includes('api.x.ai'))
  assert.equal(geminiCalls.length, 1)
  assert.equal(geminiCalls[0].headers['x-goog-api-key'], 'gemini-key-0')
  assert.equal(grokCalls.length, 1)
  assert.equal(grokCalls[0].headers.Authorization, 'Bearer grok-key-0')
  assert.equal(router.getCircuitState(), 'OPEN')
})

// 4. Gemini 502/503 -> Grok
test('4. Gemini 502/503 transient failure fails over to Grok backup', async () => {
  const callLog = []
  const mockFetch = async (url, options) => {
    callLog.push({ url, headers: options.headers })
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ error: 'Bad Gateway' }, { status: 502 })
    }
    return grokSuccess('Processed by Grok after 502')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
  })

  const res = await router.generateContent({
    contents: 'Transient gateway test',
  })

  assert.equal(res.provider, 'grok')
  assert.equal(res.keyIndex, 0)
  assert.equal(res.text, 'Processed by Grok after 502')
  assert.equal(callLog.length, 2)
})

// 5. Gemini timeout with sufficient deadline -> Grok
test('5. Gemini timeout with sufficient remaining deadline fails over to Grok', async () => {
  let virtualTime = 1000
  const clock = () => virtualTime

  const mockFetch = async (url, options) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      // Simulate Gemini timing out after 2000ms
      virtualTime += 2000
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    // Grok runs with remaining deadline
    virtualTime += 500
    return grokSuccess('Responded via Grok after Gemini timed out')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
    now: clock,
  })

  // Total budget = 10000 ms. Gemini took 2000 ms. Remaining = 8000 ms >= 1000 ms.
  const res = await router.generateContent({
    contents: 'Timeout failover test',
    timeoutMs: 10000,
  })

  assert.equal(res.provider, 'grok')
  assert.equal(res.text, 'Responded via Grok after Gemini timed out')
})

// 6. HTTP 400 fails immediately with ai_request_rejected (no key cycling, no failover)
test('6. HTTP 400 fails immediately with ai_request_rejected without key cycling or failover', async () => {
  const callLog = []
  const mockFetch = async (url, options) => {
    callLog.push({ url, headers: options.headers })
    return jsonResponse({ error: { code: 400, message: 'Invalid argument' } }, { status: 400 })
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0', 'gemini-key-1'],
    grokKeys: ['grok-key-0', 'grok-key-1'],
    fetchClient: mockFetch,
  })

  await assert.rejects(
    async () => {
      await router.generateContent({ contents: 'Bad request' })
    },
    (err) => {
      assert.equal(err.code, 'ai_request_rejected')
      assert.equal(err.status, 503)
      return true
    }
  )

  // Exactly 1 call was made; no key rotation to gemini-key-1, no call to Grok!
  assert.equal(callLog.length, 1)
  assert.ok(callLog[0].url.includes('generativelanguage.googleapis.com'))
})

// 7. Grok credential-specific authentication failure -> rotates to Grok Key 1
test('7. Grok credential-specific authentication failure (401) rotates to next Grok key', async () => {
  const callLog = []
  const mockFetch = async (url, options) => {
    callLog.push({ url, headers: options.headers })
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ error: 'Service Unavailable' }, { status: 503 })
    }
    const authHeader = options.headers.Authorization
    if (authHeader === 'Bearer grok-bad-key-0') {
      return jsonResponse({ error: { message: 'Incorrect API key' } }, { status: 401 })
    }
    return grokSuccess('Answer from Grok key 1')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-bad-key-0', 'grok-good-key-1'],
    fetchClient: mockFetch,
  })

  const res = await router.generateContent({
    contents: 'Test Grok key rotation',
  })

  assert.equal(res.provider, 'grok')
  assert.equal(res.keyIndex, 1)
  assert.equal(res.text, 'Answer from Grok key 1')

  const grokCalls = callLog.filter((c) => c.url.includes('api.x.ai'))
  assert.equal(grokCalls.length, 2)
  assert.equal(grokCalls[0].headers.Authorization, 'Bearer grok-bad-key-0')
  assert.equal(grokCalls[1].headers.Authorization, 'Bearer grok-good-key-1')
})

// 8. All providers unavailable -> returns clean ai_unavailable
test('8. All providers unavailable returns clean ai_unavailable error', async () => {
  const mockFetch = async () => {
    return jsonResponse({ error: 'Service Unavailable' }, { status: 503 })
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0', 'grok-key-1'],
    fetchClient: mockFetch,
  })

  await assert.rejects(
    async () => {
      await router.generateContent({ contents: 'All down test' })
    },
    (err) => {
      assert.equal(err.code, 'ai_unavailable')
      assert.equal(err.status, 503)
      return true
    }
  )
})

// 9. Circuit breaker opens upon consecutive failures
test('9. Circuit breaker transitions to OPEN after consecutive Gemini failures and bypasses Gemini', async () => {
  const callLog = []
  const mockFetch = async (url, options) => {
    callLog.push({ url })
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ error: 'Unavailable' }, { status: 503 })
    }
    return grokSuccess('Grok response')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
    failureThreshold: 2,
    cooldownMs: 60000,
  })

  assert.equal(router.getCircuitState(), 'CLOSED')

  // Request 1: Gemini fails 503 -> failover to Grok
  await router.generateContent({ contents: 'Req 1' })
  assert.equal(router.getCircuitState(), 'CLOSED') // threshold is 2

  // Request 2: Gemini fails 503 -> failover to Grok -> trips circuit breaker to OPEN
  await router.generateContent({ contents: 'Req 2' })
  assert.equal(router.getCircuitState(), 'OPEN')

  // Request 3: Circuit breaker is OPEN -> routes directly to Grok without touching Gemini!
  callLog.length = 0
  const res3 = await router.generateContent({ contents: 'Req 3' })
  assert.equal(res3.provider, 'grok')
  assert.equal(callLog.length, 1)
  assert.ok(callLog[0].url.includes('api.x.ai'))
})

// 10. Half-open recovery
test('10. Circuit breaker transitions to HALF_OPEN after cooldown and recovers to CLOSED upon successful probe', async () => {
  let virtualTime = 10000
  const clock = () => virtualTime
  let geminiHealthy = false

  const mockFetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      if (!geminiHealthy) {
        return jsonResponse({ error: 'Unavailable' }, { status: 503 })
      }
      return geminiSuccess('Gemini recovered successfully')
    }
    return grokSuccess('Grok response during outage')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
    failureThreshold: 1,
    cooldownMs: 60000,
    now: clock,
  })

  // Trip to OPEN
  await router.generateContent({ contents: 'Trigger trip' })
  assert.equal(router.getCircuitState(), 'OPEN')

  // Advance time by 30s (less than 60s cooldown): state remains OPEN
  virtualTime += 30000
  assert.equal(router.getCircuitState(), 'OPEN')

  // Advance time past 60s cooldown (total +61s): state is HALF_OPEN
  virtualTime += 31000
  assert.equal(router.getCircuitState(), 'HALF_OPEN')

  // Make Gemini healthy and issue probe request
  geminiHealthy = true
  const probeRes = await router.generateContent({ contents: 'Probe request' })

  assert.equal(probeRes.provider, 'gemini')
  assert.equal(probeRes.text, 'Gemini recovered successfully')
  assert.equal(router.getCircuitState(), 'CLOSED')

  // Subsequent request goes straight to Gemini normally
  const nextRes = await router.generateContent({ contents: 'Normal request' })
  assert.equal(nextRes.provider, 'gemini')
})

// 11. Concurrent recovery requests in HALF_OPEN do not trigger duplicate probes
test('11. Concurrent requests in HALF_OPEN execute only one Gemini probe while concurrent request routes to Grok', async () => {
  let virtualTime = 50000
  const clock = () => virtualTime

  let geminiCallCount = 0
  let grokCallCount = 0
  let releaseGeminiProbe = null

  const mockFetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCallCount++
      // Delay response until released
      await new Promise((resolve) => {
        releaseGeminiProbe = resolve
      })
      return geminiSuccess('Gemini trial probe passed')
    }
    grokCallCount++
    return grokSuccess('Grok concurrent response')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
    failureThreshold: 1,
    cooldownMs: 60000,
    now: clock,
  })

  // Manually trip circuit breaker to OPEN
  router.circuitBreaker.recordFailure()
  assert.equal(router.getCircuitState(), 'OPEN')

  // Advance time into HALF_OPEN
  virtualTime += 65000
  assert.equal(router.getCircuitState(), 'HALF_OPEN')

  // Launch Request A (will acquire probe and pause inside mockFetch)
  const promiseA = router.generateContent({ contents: 'Req A' })

  // Ensure Request A has initiated
  await new Promise((r) => setImmediate(r))
  assert.equal(geminiCallCount, 1)

  // Launch Request B concurrently while Request A probe is in-flight
  const promiseB = router.generateContent({ contents: 'Req B' })

  // Request B should NOT call Gemini; it routes to Grok backup!
  const resB = await promiseB
  assert.equal(resB.provider, 'grok')
  assert.equal(resB.text, 'Grok concurrent response')
  assert.equal(geminiCallCount, 1) // still only 1 probe to Gemini

  // Now release Request A's Gemini probe
  releaseGeminiProbe()
  const resA = await promiseA

  assert.equal(resA.provider, 'gemini')
  assert.equal(resA.text, 'Gemini trial probe passed')
  assert.equal(router.getCircuitState(), 'CLOSED')
})

// 12. Deadline exhaustion prevents secondary failover when time budget < 1000 ms
test('12. Deadline exhaustion prevents secondary failover when remaining time budget is under 1000 ms', async () => {
  let virtualTime = 1000
  const clock = () => virtualTime
  let grokCalled = false

  const mockFetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      // Advance clock so remaining deadline is only 300ms (< 1000ms)
      virtualTime += 1200
      return jsonResponse({ error: 'Server Error' }, { status: 503 })
    }
    grokCalled = true
    return grokSuccess('Should not reach here')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
    now: clock,
  })

  // Total budget = 1500 ms. Gemini took 1200 ms. Remaining = 300 ms (< 1000 ms).
  await assert.rejects(
    async () => {
      await router.generateContent({
        contents: 'Tight deadline test',
        timeoutMs: 1500,
      })
    },
    (err) => {
      assert.equal(err.code, 'ai_timeout')
      assert.equal(err.status, 504)
      return true
    }
  )

  assert.equal(grokCalled, false)
})

// 13. Missing credentials handled cleanly
test('13. Missing credentials handled cleanly across all configurations', async () => {
  // Case A: No Gemini keys, but Grok keys configured -> routes directly to Grok
  const routerGrokOnly = createAiRouter({
    geminiKeys: [],
    grokKeys: ['grok-key-0'],
    fetchClient: async () => grokSuccess('Direct Grok success'),
  })
  const resA = await routerGrokOnly.generateContent({ contents: 'No Gemini keys' })
  assert.equal(resA.provider, 'grok')
  assert.equal(resA.text, 'Direct Grok success')

  // Case B: No Gemini keys and no Grok keys -> throws ai_configuration
  const routerEmpty = createAiRouter({
    geminiKeys: [],
    grokKeys: [],
  })
  await assert.rejects(
    async () => {
      await routerEmpty.generateContent({ contents: 'No keys' })
    },
    (err) => {
      assert.equal(err.code, 'ai_configuration')
      return true
    }
  )

  // Case C: Gemini keys configured, no Grok keys -> Gemini error returned on failure
  const routerGeminiOnly = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: [],
    fetchClient: async () => jsonResponse({ error: 'Outage' }, { status: 503 }),
  })
  await assert.rejects(
    async () => {
      await routerGeminiOnly.generateContent({ contents: 'Gemini only fail' })
    },
    (err) => {
      assert.equal(err.code, 'ai_unavailable')
      return true
    }
  )
})

// 14. Secret-safe diagnostics (verifies no keys or Bearer tokens leak)
test('14. Secret-safe diagnostics emits telemetry without leaking credentials or tokens', async () => {
  const secretGeminiKey = 'gemini-super-secret-key-xyz-987'
  const secretGrokKey = 'xai-ultra-confidential-token-abc-456'

  const diagnosticEvents = []
  const diagnostic = (evt) => {
    diagnosticEvents.push(evt)
  }

  const mockFetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ error: 'Gateway timeout' }, { status: 504 })
    }
    return grokSuccess('Safe telemetried response')
  }

  const router = createAiRouter({
    geminiKeys: [secretGeminiKey],
    grokKeys: [secretGrokKey],
    fetchClient: mockFetch,
  })

  const res = await router.generateContent({
    contents: 'Check diagnostic security',
    diagnostic,
  })

  assert.equal(res.provider, 'grok')
  assert.ok(diagnosticEvents.length >= 2)

  // Inspect every diagnostic event object and all string properties
  for (const event of diagnosticEvents) {
    const serialized = JSON.stringify(event)
    assert.ok(!serialized.includes(secretGeminiKey), 'Diagnostic event leaked Gemini API key!')
    assert.ok(!serialized.includes(secretGrokKey), 'Diagnostic event leaked Grok API key!')
    assert.ok(!serialized.toLowerCase().includes('bearer'), 'Diagnostic event leaked Bearer prefix!')
    assert.ok(!serialized.includes('x-goog-api-key'), 'Diagnostic event leaked x-goog-api-key header!')

    // Validate expected structure
    assert.ok(typeof event.provider === 'string')
    assert.ok(Number.isInteger(event.keyIndex))
    assert.ok(Number.isInteger(event.elapsedMs))
  }
})

// 15. Backward-compatible separation from existing Gemini callers
test('15. Existing Gemini service exports and caller contracts remain untouched and separated', async () => {
  // Verify that existing backend/src/services/gemini.js exports are intact
  assert.equal(typeof geminiService.generateReply, 'function')
  assert.equal(typeof geminiService.analyzeSource, 'function')
  assert.equal(typeof geminiService.generateContent, 'function')
  assert.equal(typeof geminiService.aiError, 'function')
  assert.equal(typeof geminiService.safeDiagnostic, 'function')
  assert.equal(geminiService.API_VERSION, 'v1beta')

  // Verify that grokAdapter is intact
  assert.equal(typeof grokAdapter.generateContent, 'function')
  assert.equal(typeof grokAdapter.convertGeminiSchemaToJsonSchema, 'function')

  // Verify router export interface
  assert.equal(typeof createAiRouter, 'function')
  assert.equal(typeof AiRouter, 'function')
  assert.equal(typeof aiError, 'function')
  assert.equal(typeof safeDiagnostic, 'function')
})

// Bonus: In-memory process concurrency limiter enforcement
test('16. Process-local concurrency limiter bounds simultaneous AI executions', async () => {
  let activeInFlight = 0
  let maxObservedInFlight = 0

  const mockFetch = async () => {
    activeInFlight++
    maxObservedInFlight = Math.max(maxObservedInFlight, activeInFlight)
    await new Promise((r) => setTimeout(r, 20))
    activeInFlight--
    return geminiSuccess('Concurrency response')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
    concurrencyLimit: 2,
  })

  // Launch 5 concurrent calls
  const tasks = [1, 2, 3, 4, 5].map((i) =>
    router.generateContent({ contents: `Task ${i}` })
  )

  const results = await Promise.all(tasks)
  assert.equal(results.length, 5)
  assert.ok(maxObservedInFlight <= 2, `Observed ${maxObservedInFlight} concurrent calls exceeding limit of 2`)
})

// 17. Invalid Gemini model (HTTP 404 or bad ID) fails closed without failing over to Grok
test('17. Invalid Gemini model (HTTP 404) fails closed immediately without failing over to Grok', async () => {
  let grokCalled = false
  const mockFetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ error: { code: 404, message: 'models/invalid-gemini-model is not found' } }, { status: 404 })
    }
    grokCalled = true
    return grokSuccess('Should never be called')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
  })

  await assert.rejects(
    async () => {
      await router.generateContent({ contents: 'Test invalid model' })
    },
    (err) => {
      assert.equal(err.code, 'ai_model_unavailable')
      assert.equal(err.status, 503)
      return true
    }
  )

  assert.equal(grokCalled, false, 'Grok must not be called when Gemini fails with invalid model ID (404)')
})

// 18. Unsupported Grok model rejected with ai_configuration
test('18. Unsupported or unverified Grok model rejected with ai_configuration', () => {
  assert.throws(
    () => {
      createAiRouter({
        geminiKeys: ['gemini-key-0'],
        grokKeys: ['grok-key-0'],
        grokModel: 'invalid model syntax with spaces!',
      })
    },
    (err) => {
      assert.equal(err.code, 'ai_configuration')
      assert.ok(err.message.includes('Invalid Grok model identifier syntax'))
      return true
    }
  )
})

// 19. Explicitly configured supported Grok model accepted and passed through
test('19. Explicitly configured supported Grok model (grok-2-1212) accepted and used', async () => {
  let capturedModel = null
  const mockFetch = async (url, options) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ error: 'Unavailable' }, { status: 503 })
    }
    const body = JSON.parse(options.body)
    capturedModel = body.model
    return grokSuccess('Answer from grok-2-1212', { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 })
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    grokModel: 'grok-2-1212',
    fetchClient: mockFetch,
  })

  const res = await router.generateContent({ contents: 'Test custom model' })
  assert.equal(res.provider, 'grok')
  assert.equal(res.model, 'grok-2-1212')
  assert.equal(capturedModel, 'grok-2-1212')
})

// 20. Missing or invalid Gemini model produces clear, sanitized configuration error
test('20. Missing or blank Gemini model produces clear, sanitized configuration error', () => {
  assert.throws(
    () => {
      createAiRouter({
        geminiKeys: ['gemini-key-0'],
        geminiModel: '   ',
      })
    },
    (err) => {
      assert.equal(err.code, 'ai_configuration')
      assert.ok(err.message.includes('Gemini model configuration is missing or invalid'))
      return true
    }
  )
})

// 21. Queued request times out safely while waiting in concurrency queue
test('21. Queued request times out safely while waiting in concurrency queue without leaking slot', async () => {
  let releaseSlot = null
  const mockFetch = async () => {
    await new Promise((resolve) => {
      releaseSlot = resolve
    })
    return geminiSuccess('Slot completed')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
    concurrencyLimit: 1,
  })

  // Task 1 occupies the single concurrency slot
  const task1 = router.generateContent({ contents: 'Hold slot' })
  await new Promise((r) => setImmediate(r))

  // Task 2 arrives and waits in queue with a 50ms budget
  const task2Promise = router.generateContent({
    contents: 'Queued task',
    timeoutMs: 50,
  })

  await assert.rejects(
    async () => {
      await task2Promise
    },
    (err) => {
      assert.equal(err.code, 'ai_timeout')
      return true
    }
  )

  // Release task 1
  releaseSlot()
  await task1

  // Verify that concurrency limiter returned to 0 active
  assert.equal(router.concurrencyLimiter.getMetrics().active, 0)
  assert.equal(router.concurrencyLimiter.getMetrics().queued, 0)
})

// 22. Queued request cancelled safely via AbortSignal without leaking slot
test('22. Queued request cancelled safely via AbortSignal without leaking slot', async () => {
  let releaseSlot = null
  const mockFetch = async () => {
    await new Promise((resolve) => {
      releaseSlot = resolve
    })
    return geminiSuccess('Slot completed')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
    concurrencyLimit: 1,
  })

  // Task 1 occupies the slot
  const task1 = router.generateContent({ contents: 'Hold slot' })
  await new Promise((r) => setImmediate(r))

  const controller = new AbortController()

  // Task 2 arrives and waits in queue
  const task2Promise = router.generateContent({
    contents: 'Queued task to abort',
    signal: controller.signal,
  })

  // Abort task 2 while queued
  controller.abort()

  await assert.rejects(
    async () => {
      await task2Promise
    },
    (err) => {
      assert.equal(err.code, 'ai_timeout')
      assert.ok(err.message.includes('cancelled'))
      return true
    }
  )

  // Release task 1
  releaseSlot()
  await task1

  assert.equal(router.concurrencyLimiter.getMetrics().active, 0)
  assert.equal(router.concurrencyLimiter.getMetrics().queued, 0)
})

// 23. Circuit breaker does not permanently disable healthy keys on transient 502/503/429
test('23. Circuit breaker does not permanently disable healthy keys on transient 502/503/429', async () => {
  let virtualTime = 1000
  const clock = () => virtualTime
  let geminiFailing = true

  const mockFetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      if (geminiFailing) {
        return jsonResponse({ error: 'Overloaded' }, { status: 503 })
      }
      return geminiSuccess('Gemini healthy again')
    }
    return grokSuccess('Grok backup during outage')
  }

  const router = createAiRouter({
    geminiKeys: ['gemini-key-0'],
    grokKeys: ['grok-key-0'],
    fetchClient: mockFetch,
    failureThreshold: 1,
    cooldownMs: 30000,
    now: clock,
  })

  // 1. Transient failure occurs -> circuit breaker trips to OPEN
  const res1 = await router.generateContent({ contents: 'Req 1' })
  assert.equal(res1.provider, 'grok')
  assert.equal(router.getCircuitState(), 'OPEN')

  // Verify that key-0 was NOT disabled in geminiDisabledKeys!
  assert.equal(router.geminiDisabledKeys.size, 0, 'Key must not be disabled for transient 503')

  // 2. Cooldown elapses, Gemini recovers
  virtualTime += 35000
  geminiFailing = false
  assert.equal(router.getCircuitState(), 'HALF_OPEN')

  // 3. Next request probes Gemini with key-0 and succeeds!
  const res2 = await router.generateContent({ contents: 'Req 2' })
  assert.equal(res2.provider, 'gemini')
  assert.equal(res2.keyIndex, 0)
  assert.equal(res2.text, 'Gemini healthy again')
  assert.equal(router.getCircuitState(), 'CLOSED')
})
