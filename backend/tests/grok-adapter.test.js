require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const grokAdapter = require('../src/services/ai/grokAdapter')

function mockFetch(handler) {
  return async (url, options) => handler(url, options)
}

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

test('1. Plain-text generation success maps to normalized response contract', async () => {
  let capturedUrl = null
  let capturedOptions = null

  const fetchClient = mockFetch(async (url, options) => {
    capturedUrl = url
    capturedOptions = options
    return jsonResponse({
      id: 'chatcmpl-test-1',
      object: 'chat.completion',
      model: 'grok-2-mini',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Here is your engineering answer.' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 25,
        completion_tokens: 10,
        total_tokens: 35,
      },
    })
  })

  const res = await grokAdapter.generateContent({
    apiKey: 'xai-test-key-12345',
    model: 'grok-2-mini',
    system: 'You are DevNexus AI.',
    contents: [{ role: 'user', content: 'Explain architectural patterns.' }],
    fetchClient,
  })

  assert.equal(res.text, 'Here is your engineering answer.')
  assert.equal(res.provider, 'grok')
  assert.equal(res.model, 'grok-2-mini')
  assert.deepEqual(res.usage, {
    promptTokens: 25,
    completionTokens: 10,
    totalTokens: 35,
  })

  assert.equal(capturedUrl, grokAdapter.API_ENDPOINT)
  assert.equal(capturedOptions.method, 'POST')
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json')
  assert.equal(capturedOptions.headers.Authorization, 'Bearer xai-test-key-12345')

  const parsedBody = JSON.parse(capturedOptions.body)
  assert.equal(parsedBody.model, 'grok-2-mini')
  assert.deepEqual(parsedBody.messages, [
    { role: 'system', content: 'You are DevNexus AI.' },
    { role: 'user', content: 'Explain architectural patterns.' },
  ])
})

test('2. Structured JSON generation success with Gemini contents and schema (json_object & json_schema modes)', async () => {
  const geminiFindingsSchema = {
    type: 'OBJECT',
    required: ['findings'],
    properties: {
      findings: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          required: ['line', 'category', 'problem'],
          properties: {
            line: { type: 'INTEGER' },
            category: { type: 'STRING' },
            problem: { type: 'STRING' },
          },
        },
      },
    },
  }

  // 2a. json_object mode
  let sentBodyObj = null
  const fetchObjMode = mockFetch(async (_url, options) => {
    sentBodyObj = JSON.parse(options.body)
    return jsonResponse({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '{"findings":[{"line":42,"category":"Bug","problem":"Null pointer risk"}]}',
          },
          finish_reason: 'stop',
        },
      ],
    })
  })

  const resObj = await grokAdapter.generateContent({
    apiKey: 'xai-key-abc',
    system: 'Review code as untrusted text.',
    contents: [
      { role: 'user', parts: [{ text: 'const a = null; a.run();' }] },
    ],
    json: true,
    responseSchema: geminiFindingsSchema,
    structuredMode: 'json_object',
    fetchClient: fetchObjMode,
  })

  assert.equal(resObj.provider, 'grok')
  assert.ok(resObj.text.includes('Null pointer risk'))
  assert.equal(sentBodyObj.response_format.type, 'json_object')
  assert.ok(sentBodyObj.messages[0].content.includes('Return ONLY a valid JSON object strictly adhering to this JSON Schema'))
  assert.equal(sentBodyObj.messages[1].content, 'const a = null; a.run();')

  // 2b. json_schema mode
  let sentBodySchema = null
  const fetchSchemaMode = mockFetch(async (_url, options) => {
    sentBodySchema = JSON.parse(options.body)
    return jsonResponse({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '{"findings":[{"line":10,"category":"Security","problem":"Injection"}]}',
          },
          finish_reason: 'stop',
        },
      ],
    })
  })

  const resSchema = await grokAdapter.generateContent({
    apiKey: 'xai-key-abc',
    contents: [{ role: 'user', content: 'analyze this' }],
    json: true,
    responseSchema: geminiFindingsSchema,
    structuredMode: 'json_schema',
    fetchClient: fetchSchemaMode,
  })

  assert.equal(resSchema.provider, 'grok')
  assert.equal(sentBodySchema.response_format.type, 'json_schema')
  assert.equal(sentBodySchema.response_format.json_schema.strict, true)
  assert.equal(sentBodySchema.response_format.json_schema.schema.type, 'object')
  assert.equal(sentBodySchema.response_format.json_schema.schema.properties.findings.type, 'array')
})

test('3. Schema conversion handles all supported Gemini types and recursive structures', () => {
  const fullGeminiSchema = {
    type: 'OBJECT',
    description: 'Project review findings schema',
    required: ['id', 'verified', 'score', 'tags', 'meta'],
    properties: {
      id: { type: 'STRING', format: 'uuid' },
      verified: { type: 'BOOLEAN' },
      score: { type: 'NUMBER' },
      tags: {
        type: 'ARRAY',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'STRING',
          enum: ['core', 'infra', 'ui'],
        },
      },
      meta: {
        type: 'OBJECT',
        nullable: true,
        properties: {
          retryCount: { type: 'INTEGER' },
        },
      },
    },
  }

  const converted = grokAdapter.convertGeminiSchemaToJsonSchema(fullGeminiSchema)

  assert.equal(converted.type, 'object')
  assert.equal(converted.description, 'Project review findings schema')
  assert.deepEqual(converted.required, ['id', 'verified', 'score', 'tags', 'meta'])
  assert.equal(converted.additionalProperties, false)

  assert.equal(converted.properties.id.type, 'string')
  assert.equal(converted.properties.id.format, 'uuid')
  assert.equal(converted.properties.verified.type, 'boolean')
  assert.equal(converted.properties.score.type, 'number')

  assert.equal(converted.properties.tags.type, 'array')
  assert.equal(converted.properties.tags.minItems, 1)
  assert.equal(converted.properties.tags.maxItems, 5)
  assert.equal(converted.properties.tags.items.type, 'string')
  assert.deepEqual(converted.properties.tags.items.enum, ['core', 'infra', 'ui'])

  assert.deepEqual(converted.properties.meta.type, ['object', 'null'])
  assert.equal(converted.properties.meta.properties.retryCount.type, 'integer')
  assert.equal(converted.properties.meta.additionalProperties, false)
})

test('4. Unsupported schema constraints or invalid inputs are explicitly rejected', () => {
  // Non-object
  assert.throws(
    () => grokAdapter.convertGeminiSchemaToJsonSchema(null),
    (err) => err.code === 'ai_configuration' && err.message.includes('must be a plain object')
  )

  // Missing type
  assert.throws(
    () => grokAdapter.convertGeminiSchemaToJsonSchema({ description: 'no type' }),
    (err) => err.code === 'ai_configuration' && err.message.includes('missing required "type"')
  )

  // Unsupported type
  assert.throws(
    () => grokAdapter.convertGeminiSchemaToJsonSchema({ type: 'UNSUPPORTED_TYPE' }),
    (err) => err.code === 'ai_configuration' && err.message.includes('Unsupported Gemini schema type')
  )

  // Unsupported constraint (e.g. patternProperties)
  assert.throws(
    () => grokAdapter.convertGeminiSchemaToJsonSchema({
      type: 'OBJECT',
      patternProperties: { '.*': { type: 'STRING' } },
    }),
    (err) => err.code === 'ai_configuration' && err.message.includes('Unsupported schema constraint: "patternProperties"')
  )

  // Array missing items
  assert.throws(
    () => grokAdapter.convertGeminiSchemaToJsonSchema({ type: 'ARRAY' }),
    (err) => err.code === 'ai_configuration' && err.message.includes('must define valid "items"')
  )
})

test('5. Authentication failure (HTTP 401 & 403) maps to ai_authentication with 503 status', async () => {
  for (const status of [401, 403]) {
    const fetchClient = mockFetch(async () => {
      return jsonResponse(
        { error: { message: 'Incorrect API key provided' } },
        { status }
      )
    })

    await assert.rejects(
      async () => {
        await grokAdapter.generateContent({
          apiKey: 'invalid-key',
          contents: [{ role: 'user', content: 'test' }],
          fetchClient,
        })
      },
      (err) => {
        assert.equal(err.code, 'ai_authentication')
        assert.equal(err.status, 503)
        assert.ok(err.message.includes('Grok API key is invalid or lacks access.'))
        return true
      }
    )
  }
})

test('6. Rate limiting (HTTP 429) maps to ai_quota with bounded retryAfterSeconds', async () => {
  const fetchWithRetryAfter = mockFetch(async () => {
    return jsonResponse(
      { error: { message: 'Rate limit exceeded' } },
      {
        status: 429,
        headers: { 'retry-after': '120' },
      }
    )
  })

  await assert.rejects(
    async () => {
      await grokAdapter.generateContent({
        apiKey: 'xai-valid-key',
        contents: [{ role: 'user', content: 'test' }],
        fetchClient: fetchWithRetryAfter,
      })
    },
    (err) => {
      assert.equal(err.code, 'ai_quota')
      assert.equal(err.status, 429)
      assert.equal(err.retryAfterSeconds, 120)
      return true
    }
  )

  // Without header defaults to 60
  const fetchWithoutHeader = mockFetch(async () => {
    return jsonResponse({ error: { message: 'Too many requests' } }, { status: 429 })
  })

  await assert.rejects(
    async () => {
      await grokAdapter.generateContent({
        apiKey: 'xai-valid-key',
        contents: [{ role: 'user', content: 'test' }],
        fetchClient: fetchWithoutHeader,
      })
    },
    (err) => {
      assert.equal(err.code, 'ai_quota')
      assert.equal(err.status, 429)
      assert.equal(err.retryAfterSeconds, 60)
      return true
    }
  )
})

test('7. Provider HTTP 500, 502, 503, 504 map to ai_unavailable with 503 status', async () => {
  for (const status of [500, 502, 503, 504]) {
    const fetchClient = mockFetch(async () => {
      return jsonResponse({ error: { message: 'Internal Server Error' } }, { status })
    })

    await assert.rejects(
      async () => {
        await grokAdapter.generateContent({
          apiKey: 'xai-valid-key',
          contents: [{ role: 'user', content: 'test' }],
          fetchClient,
        })
      },
      (err) => {
        assert.equal(err.code, 'ai_unavailable')
        assert.equal(err.status, 503)
        assert.ok(err.message.includes('Grok service is unavailable.'))
        return true
      }
    )
  }
})

test('8. Timeout and cancellation map to ai_timeout with 504 status', async () => {
  const fetchTimeout = mockFetch(async (_url, options) => {
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const abortErr = new Error('The operation was aborted')
        abortErr.name = 'AbortError'
        reject(abortErr)
      })
    })
  })

  await assert.rejects(
    async () => {
      await grokAdapter.generateContent({
        apiKey: 'xai-valid-key',
        contents: [{ role: 'user', content: 'test' }],
        timeoutMs: 50,
        fetchClient: fetchTimeout,
      })
    },
    (err) => {
      assert.equal(err.code, 'ai_timeout')
      assert.equal(err.status, 504)
      assert.ok(err.message.includes('Grok request timed out.'))
      return true
    }
  )
})

test('9. Invalid response handling (empty choices, output limit, content filter, oversize, non-JSON)', async () => {
  // 9a. Empty choices
  const fetchNoChoices = mockFetch(async () => jsonResponse({ choices: [] }))
  await assert.rejects(
    async () => {
      await grokAdapter.generateContent({
        apiKey: 'test-key',
        contents: [{ role: 'user', content: 'hi' }],
        fetchClient: fetchNoChoices,
      })
    },
    (err) => err.code === 'ai_malformed_response' && err.message.includes('no choices')
  )

  // 9b. Empty content
  const fetchEmptyContent = mockFetch(async () => jsonResponse({
    choices: [{ message: { content: '   ' } }],
  }))
  await assert.rejects(
    async () => {
      await grokAdapter.generateContent({
        apiKey: 'test-key',
        contents: [{ role: 'user', content: 'hi' }],
        fetchClient: fetchEmptyContent,
      })
    },
    (err) => err.code === 'ai_malformed_response' && err.message.includes('empty or invalid output')
  )

  // 9c. Finish reason: length -> ai_output_limit
  const fetchLengthLimit = mockFetch(async () => jsonResponse({
    choices: [{ message: { content: 'Incomplete output...' }, finish_reason: 'length' }],
  }))
  await assert.rejects(
    async () => {
      await grokAdapter.generateContent({
        apiKey: 'test-key',
        contents: [{ role: 'user', content: 'hi' }],
        fetchClient: fetchLengthLimit,
      })
    },
    (err) => err.code === 'ai_output_limit' && err.status === 502
  )

  // 9d. Finish reason: content_filter -> ai_blocked
  const fetchContentFilter = mockFetch(async () => jsonResponse({
    choices: [{ message: { content: 'Blocked...' }, finish_reason: 'content_filter' }],
  }))
  await assert.rejects(
    async () => {
      await grokAdapter.generateContent({
        apiKey: 'test-key',
        contents: [{ role: 'user', content: 'hi' }],
        fetchClient: fetchContentFilter,
      })
    },
    (err) => err.code === 'ai_blocked' && err.status === 422
  )

  // 9e. Malformed non-JSON
  const fetchNonJson = mockFetch(async () => new Response('<html>502 Bad Gateway</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  }))
  await assert.rejects(
    async () => {
      await grokAdapter.generateContent({
        apiKey: 'test-key',
        contents: [{ role: 'user', content: 'hi' }],
        fetchClient: fetchNonJson,
      })
    },
    (err) => err.code === 'ai_malformed_response'
  )

  // 9f. Oversized response > 256,000 bytes
  const oversizedText = 'A'.repeat(260000)
  const fetchOversized = mockFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: oversizedText } }],
  })))
  await assert.rejects(
    async () => {
      await grokAdapter.generateContent({
        apiKey: 'test-key',
        contents: [{ role: 'user', content: 'hi' }],
        fetchClient: fetchOversized,
      })
    },
    (err) => err.code === 'ai_malformed_response' && err.message.includes('exceeded the output limit')
  )
})

test('10. Diagnostics telemetry is secret-safe (never leaks API keys, headers, or raw secrets)', async () => {
  const secretKey = 'super-secret-xai-live-key-xyz-789'
  const diagnosticEvents = []

  const fetchClient = mockFetch(async () => {
    return jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'Safe output.' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })
  })

  const res = await grokAdapter.generateContent({
    apiKey: secretKey,
    contents: [{ role: 'user', content: 'Hello secret prompt' }],
    diagnostic: (event) => diagnosticEvents.push(event),
    fetchClient,
  })

  assert.equal(res.text, 'Safe output.')
  assert.ok(diagnosticEvents.length >= 1)

  const serializedDiagnostics = JSON.stringify(diagnosticEvents)
  assert.equal(serializedDiagnostics.includes(secretKey), false)
  assert.equal(serializedDiagnostics.includes('Bearer'), false)
  assert.equal(serializedDiagnostics.includes('Authorization'), false)

  const finalEvent = diagnosticEvents[diagnosticEvents.length - 1]
  assert.equal(finalEvent.provider, 'grok')
  assert.equal(finalEvent.category, 'ok')
  assert.equal(finalEvent.diagnosticCategory, 'generation_success')
  assert.equal(finalEvent.phase, 'generation_completed')
  assert.equal(finalEvent.httpStatus, 200)
  assert.ok(finalEvent.requestBytes > 0)
  assert.ok(Number.isInteger(finalEvent.elapsedMs))
})
