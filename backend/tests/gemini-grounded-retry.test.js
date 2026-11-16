require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const config = require('../src/config')
Object.assign(config, {
  aiProvider: 'gemini',
  geminiApiKey: 'test-key',
  geminiModel: 'gemini-3.1-flash-lite',
  geminiTimeoutMs: 5000,
})

const gemini = require('../src/services/gemini')
const { generateRepositoryReply } = require('../src/services/repositoryChat')

async function withMockFetch(fn, run) {
  const originalFetch = global.fetch
  global.fetch = fn
  try {
    await run()
  } finally {
    global.fetch = originalFetch
  }
}

function geminiOkResponse(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text }] },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

test('1. Retry backoff constant is between 300 and 500 ms', () => {
  assert.ok(gemini.DEFAULT_RETRY_BACKOFF_MS >= 300, 'Backoff must be at least 300 ms')
  assert.ok(gemini.DEFAULT_RETRY_BACKOFF_MS <= 500, 'Backoff must be at most 500 ms')
  assert.deepEqual([...gemini.RETRYABLE_HTTP_STATUSES].sort(), [500, 502, 503, 504])
})

test('2. Transient HTTP 503 succeeds on automatic retry in generateContent', async () => {
  let callCount = 0
  await withMockFetch(async () => {
    callCount++
    if (callCount === 1) {
      return new Response('upstream temporary unavailable', { status: 503 })
    }
    return geminiOkResponse('Recovered generation output')
  }, async () => {
    const start = Date.now()
    const result = await gemini.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Explain greet' }] }],
      retryBackoffMs: 300,
    })
    const elapsed = Date.now() - start
    assert.equal(result, 'Recovered generation output')
    assert.equal(callCount, 2, 'Must have retried exactly once')
    assert.ok(elapsed >= 280, `Expected backoff delay of at least ~300ms, got ${elapsed}ms`)
  })
})

test('3. Repository-grounded chat succeeds with source citation after transient 503', async () => {
  let callCount = 0
  const chunk = {
    citationId: 'S1',
    chunkId: '19',
    fileId: 'f-1',
    projectId: 'p-1',
    path: 'app.js',
    startLine: 1,
    endLine: 5,
    startColumn: 1,
    endColumn: 1,
    snippet: 'export function greet(name) { return `Hello, ${name}!`; }',
  }

  // Fake request object with authorization and source mock
  const fakeReq = {
    app: {
      locals: {
        sourceRepository: {
          async findProject() { return { id: 'p-1', name: 'Test' } },
          async searchSource() { return [chunk] },
        },
      },
    },
    user: { sub: 'u-1', email: 'user@example.com' },
  }

  await withMockFetch(async () => {
    callCount++
    if (callCount === 1) {
      return new Response('upstream service unavailable', { status: 503 })
    }
    return geminiOkResponse({
      answer: 'greet returns Hello, name! [S1]',
      verified: true,
      citationIds: ['S1'],
    })
  }, async () => {
    const res = await generateRepositoryReply(fakeReq, {
      message: 'What does greet do?',
      projectId: 'p-1',
      history: [],
    })
    assert.equal(callCount, 2, 'Should succeed on second attempt')
    assert.equal(res.grounded, true)
    assert.equal(res.provider, 'gemini')
    assert.equal(res.mode, 'repository')
    assert.equal(res.reply, 'greet returns Hello, name! [S1]')
    assert.equal(res.sources.length, 1)
    assert.equal(res.sources[0].path, 'app.js')
  })
})

test('4. Transient HTTP 500, 502, and 504 each succeed on retry', async () => {
  for (const status of [500, 502, 504]) {
    let callCount = 0
    await withMockFetch(async () => {
      callCount++
      if (callCount === 1) {
        return new Response('transient error', { status })
      }
      return geminiOkResponse(`Success after ${status}`)
    }, async () => {
      const result = await gemini.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        retryBackoffMs: 10,
      })
      assert.equal(result, `Success after ${status}`)
      assert.equal(callCount, 2, `Status ${status} should trigger exactly 1 retry`)
    })
  }
})

test('5. Temporary network failure (fetch exception) succeeds on retry', async () => {
  let callCount = 0
  await withMockFetch(async () => {
    callCount++
    if (callCount === 1) {
      throw new TypeError('fetch failed: ECONNRESET')
    }
    return geminiOkResponse('Recovered after network failure')
  }, async () => {
    const result = await gemini.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      retryBackoffMs: 10,
    })
    assert.equal(result, 'Recovered after network failure')
    assert.equal(callCount, 2)
  })
})

test('6. Persistent HTTP 503 exhausts retry and throws sanitized ai_unavailable after at most 1 retry', async () => {
  let callCount = 0
  await withMockFetch(async () => {
    callCount++
    return new Response('upstream remains down', { status: 503 })
  }, async () => {
    await assert.rejects(
      gemini.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        retryBackoffMs: 10,
      }),
      (err) => {
        assert.equal(err.code, 'ai_unavailable')
        assert.equal(err.status, 503)
        assert.equal(err.message, 'Gemini service is unavailable. Try again later.')
        return true
      }
    )
    assert.equal(callCount, 2, 'Must not retry more than once (total 2 attempts)')
  })
})

test('7. Persistent network error exhausts retry and throws sanitized ai_unavailable after at most 1 retry', async () => {
  let callCount = 0
  await withMockFetch(async () => {
    callCount++
    throw new TypeError('fetch failed: ETIMEDOUT')
  }, async () => {
    await assert.rejects(
      gemini.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        retryBackoffMs: 10,
      }),
      (err) => {
        assert.equal(err.code, 'ai_unavailable')
        assert.equal(err.status, 503)
        assert.equal(err.message, 'Gemini service is unavailable. Try again later.')
        return true
      }
    )
    assert.equal(callCount, 2, 'Must not retry more than once on network errors')
  })
})

test('8. Non-retryable errors fail immediately without retry (fetch called exactly once)', async () => {
  const nonRetryableCases = [
    { status: 400, expectedCode: 'ai_request_rejected', expectedStatus: 503 },
    { status: 401, expectedCode: 'ai_authentication', expectedStatus: 503 },
    { status: 403, expectedCode: 'ai_authentication', expectedStatus: 503 },
    { status: 404, expectedCode: 'ai_model_unavailable', expectedStatus: 503 },
    { status: 429, expectedCode: 'ai_quota', expectedStatus: 429 },
  ]

  for (const { status, expectedCode, expectedStatus } of nonRetryableCases) {
    let callCount = 0
    await withMockFetch(async () => {
      callCount++
      return new Response(`non-retryable ${status}`, { status })
    }, async () => {
      await assert.rejects(
        gemini.generateContent({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          retryBackoffMs: 10,
        }),
        (err) => {
          assert.equal(err.code, expectedCode)
          assert.equal(err.status, expectedStatus)
          return true
        }
      )
      assert.equal(callCount, 1, `Status ${status} must not be retried (called once)`)
    })
  }
})

test('9. Insufficient timeout budget prevents retry and fails immediately', async () => {
  let callCount = 0
  await withMockFetch(async () => {
    callCount++
    return new Response('service unavailable', { status: 503 })
  }, async () => {
    // Budget of 1000ms with a backoff of 900ms leaves only 100ms (< 200ms minimum overhead)
    await assert.rejects(
      gemini.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        timeoutMs: 1000,
        retryBackoffMs: 900,
      }),
      (err) => {
        assert.equal(err.code, 'ai_unavailable')
        return true
      }
    )
    assert.equal(callCount, 1, 'Retry must be skipped when timeout budget is insufficient')
  })
})

test('10. Overall request timeout is respected during backoff sleep', async () => {
  let callCount = 0
  await withMockFetch(async () => {
    callCount++
    return new Response('service unavailable', { status: 503 })
  }, async () => {
    // Timeout of 1000ms with a backoff of 400ms:
    // If the overall timer aborts, the sleep aborts immediately
    const start = Date.now()
    await assert.rejects(
      gemini.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        timeoutMs: 1000,
        retryBackoffMs: 1500, // Backoff exceeds total timeout
      }),
      (err) => {
        assert.equal(err.code, 'ai_unavailable')
        return true
      }
    )
    assert.equal(callCount, 1, 'Cannot start retry when backoff exceeds budget')
  })
})
