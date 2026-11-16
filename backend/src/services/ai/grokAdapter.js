const API_ENDPOINT = 'https://api.x.ai/v1/chat/completions'
const DEFAULT_MODEL = 'grok-2-mini'
const MAX_RESPONSE_BYTES = 256000

function aiError(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status })
}

function safeDiagnostic(callback, event) {
  try {
    const result = callback?.(event)
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch {}
}

const TYPE_MAP = Object.freeze({
  OBJECT: 'object',
  ARRAY: 'array',
  STRING: 'string',
  INTEGER: 'integer',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  object: 'object',
  array: 'array',
  string: 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
})

const ALLOWED_SCHEMA_KEYS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'minItems',
  'maxItems',
  'nullable',
  'format',
])

function convertGeminiSchemaToJsonSchema(geminiSchema) {
  if (!geminiSchema || typeof geminiSchema !== 'object' || Array.isArray(geminiSchema)) {
    throw aiError('ai_configuration', 'Invalid schema: must be a plain object.', 503)
  }

  for (const key of Object.keys(geminiSchema)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) {
      throw aiError('ai_configuration', `Unsupported schema constraint: "${key}".`, 503)
    }
  }

  const rawType = geminiSchema.type
  if (!rawType) {
    throw aiError('ai_configuration', 'Gemini schema is missing required "type" field.', 503)
  }

  const mappedType = TYPE_MAP[rawType]
  if (!mappedType) {
    throw aiError('ai_configuration', `Unsupported Gemini schema type: "${rawType}".`, 503)
  }

  const result = { type: mappedType }

  if (typeof geminiSchema.description === 'string') {
    result.description = geminiSchema.description
  }

  if (Array.isArray(geminiSchema.enum)) {
    result.enum = [...geminiSchema.enum]
  }

  if (typeof geminiSchema.format === 'string') {
    result.format = geminiSchema.format
  }

  if (mappedType === 'object') {
    if (geminiSchema.properties && typeof geminiSchema.properties === 'object' && !Array.isArray(geminiSchema.properties)) {
      result.properties = {}
      for (const [propKey, propVal] of Object.entries(geminiSchema.properties)) {
        result.properties[propKey] = convertGeminiSchemaToJsonSchema(propVal)
      }
    }
    if (Array.isArray(geminiSchema.required)) {
      result.required = [...geminiSchema.required]
    }
    result.additionalProperties = false
  } else if (mappedType === 'array') {
    if (!geminiSchema.items || typeof geminiSchema.items !== 'object') {
      throw aiError('ai_configuration', 'Array schema must define valid "items" object.', 503)
    }
    result.items = convertGeminiSchemaToJsonSchema(geminiSchema.items)
    if (typeof geminiSchema.minItems === 'number' && Number.isInteger(geminiSchema.minItems)) {
      result.minItems = geminiSchema.minItems
    }
    if (typeof geminiSchema.maxItems === 'number' && Number.isInteger(geminiSchema.maxItems)) {
      result.maxItems = geminiSchema.maxItems
    }
  }

  if (geminiSchema.nullable === true) {
    result.type = [mappedType, 'null']
  }

  return result
}

function toChatMessages(contents, systemInstruction, schemaPrompt) {
  const messages = []
  const systemParts = [systemInstruction, schemaPrompt].filter(Boolean)
  if (systemParts.length > 0) {
    messages.push({ role: 'system', content: systemParts.join('\n\n') })
  }

  if (Array.isArray(contents)) {
    for (const item of contents) {
      if (!item) continue
      const role = item.role === 'model' || item.role === 'assistant' ? 'assistant' : 'user'
      let text = ''
      if (Array.isArray(item.parts)) {
        text = item.parts
          .filter((p) => p && !p.thought && typeof p.text === 'string')
          .map((p) => p.text)
          .join('')
      } else if (typeof item.content === 'string') {
        text = item.content
      } else if (typeof item.text === 'string') {
        text = item.text
      }
      messages.push({ role, content: text })
    }
  } else if (typeof contents === 'string') {
    messages.push({ role: 'user', content: contents })
  }

  return messages
}

async function readResponseBody(res) {
  let raw = ''
  let bytes = 0

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {})
          throw aiError('ai_malformed_response', 'Grok response exceeded the output limit.')
        }
        raw += decoder.decode(value, { stream: true })
      }
      raw += decoder.decode()
    } finally {
      reader.releaseLock?.()
    }
  } else if (typeof res.text === 'function') {
    raw = await res.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
      throw aiError('ai_malformed_response', 'Grok response exceeded the output limit.')
    }
  } else {
    throw aiError('ai_malformed_response', 'Grok response body is unreadable.')
  }

  return raw
}

async function generateContent({
  apiKey,
  model = DEFAULT_MODEL,
  system,
  contents,
  json = false,
  responseSchema,
  structuredMode = 'json_object',
  diagnostic,
  timeoutMs = 60000,
  fetchClient = globalThis.fetch,
  endpoint = API_ENDPOINT,
}) {
  let httpStatus = null
  let requestBytes = 0
  let phase = 'request_preparation'
  const started = Date.now()

  const report = (category, diagnosticCategory = category) => {
    safeDiagnostic(diagnostic, {
      provider: 'grok',
      model: typeof model === 'string' && /^[a-zA-Z0-9._/-]{1,120}$/.test(model) ? model : '[invalid model]',
      httpStatus,
      category,
      diagnosticCategory,
      phase,
      elapsedMs: Date.now() - started,
      requestBytes,
    })
  }

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    const err = aiError('ai_configuration', 'Grok requires a valid server API key.', 503)
    report('ai_configuration', 'missing_api_key')
    throw err
  }

  if (typeof model !== 'string' || !/^[a-zA-Z0-9._/-]{1,120}$/.test(model)) {
    const err = aiError('ai_configuration', 'Invalid Grok model identifier.', 503)
    report('ai_configuration', 'invalid_model')
    throw err
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    const err = aiError('ai_configuration', 'Invalid Grok request timeout budget (must be 1-120000 ms).', 503)
    report('ai_configuration', 'invalid_timeout')
    throw err
  }

  if (!['json_object', 'json_schema'].includes(structuredMode)) {
    const err = aiError('ai_configuration', `Unsupported structured mode: "${structuredMode}".`, 503)
    report('ai_configuration', 'unsupported_structured_mode')
    throw err
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let convertedSchema = null
    let schemaDirective = null

    if (responseSchema) {
      convertedSchema = convertGeminiSchemaToJsonSchema(responseSchema)
    }

    const bodyPayload = {
      model,
      temperature: 0.2,
      max_tokens: json || responseSchema ? 4096 : 2048,
    }

    if (json || responseSchema) {
      if (structuredMode === 'json_schema') {
        if (!convertedSchema) {
          throw aiError('ai_configuration', 'structuredMode "json_schema" requires responseSchema.', 503)
        }
        bodyPayload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'response_schema',
            strict: true,
            schema: convertedSchema,
          },
        }
      } else {
        bodyPayload.response_format = { type: 'json_object' }
        if (convertedSchema) {
          schemaDirective = `Return ONLY a valid JSON object strictly adhering to this JSON Schema:\n${JSON.stringify(convertedSchema)}\nNo Markdown code fences, no commentary.`
        }
      }
    }

    bodyPayload.messages = toChatMessages(contents, system, schemaDirective)

    const serializedBody = JSON.stringify(bodyPayload)
    requestBytes = Buffer.byteLength(serializedBody, 'utf8')

    phase = 'fetch'
    const res = await fetchClient(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: serializedBody,
      signal: controller.signal,
    })

    httpStatus = res.status
    phase = 'http_response'

    if (!res.ok) {
      if ([401, 403].includes(res.status)) {
        throw aiError('ai_authentication', 'Grok API key is invalid or lacks access.', 503)
      }
      if (res.status === 429) {
        const error = aiError('ai_quota', 'Grok quota or rate limit exceeded. Try again later.', 429)
        const header = res.headers?.get?.('retry-after')
        const seconds = header && /^\d+$/.test(header)
          ? Number(header)
          : header
            ? Math.ceil((Date.parse(header) - Date.now()) / 1000)
            : 60
        error.retryAfterSeconds = Number.isFinite(seconds) ? Math.max(60, Math.min(3600, seconds)) : 60
        throw error
      }
      if (res.status === 400) {
        throw aiError('ai_request_rejected', 'Grok rejected the request. Check model configuration.', 503)
      }
      if (res.status === 404) {
        throw aiError('ai_model_unavailable', 'Grok model not found or resource unavailable.', 503)
      }
      throw aiError('ai_unavailable', 'Grok service is unavailable. Try again later.', 503)
    }

    phase = 'response_stream'
    const rawBody = await readResponseBody(res)

    phase = 'response_validation'
    let data
    try {
      data = JSON.parse(rawBody)
    } catch {
      throw aiError('ai_malformed_response', 'Grok returned an invalid response body.')
    }

    const choice = data?.choices?.[0]
    if (!choice) {
      throw aiError('ai_malformed_response', 'Grok returned no choices in response.')
    }

    if (choice.finish_reason === 'length') {
      throw aiError('ai_output_limit', 'Grok output was incomplete. Try a smaller request.')
    }

    if (choice.finish_reason === 'content_filter') {
      throw aiError('ai_blocked', 'Grok could not provide output for this request due to content policy.', 422)
    }

    const content = choice.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw aiError('ai_malformed_response', 'Grok returned empty or invalid output.')
    }

    phase = 'generation_completed'
    report('ok', 'generation_success')

    const result = {
      text: content.trim(),
      provider: 'grok',
      model,
    }

    if (data.usage && typeof data.usage === 'object') {
      result.usage = {
        promptTokens: Number.isInteger(data.usage.prompt_tokens) ? data.usage.prompt_tokens : 0,
        completionTokens: Number.isInteger(data.usage.completion_tokens) ? data.usage.completion_tokens : 0,
        totalTokens: Number.isInteger(data.usage.total_tokens) ? data.usage.total_tokens : 0,
      }
    }

    return result
  } catch (err) {
    const isTimeout = controller.signal.aborted || err.name === 'AbortError'
    const category = isTimeout ? 'ai_timeout' : err.code?.startsWith('ai_') ? err.code : 'ai_unavailable'
    const reason = isTimeout
      ? 'grok_timeout'
      : phase === 'http_response'
        ? `http_${httpStatus}`
        : category
    report(category, reason)

    if (isTimeout) {
      throw aiError('ai_timeout', 'Grok request timed out. Try again.', 504)
    }
    if (err.code?.startsWith('ai_')) {
      throw err
    }
    throw aiError('ai_unavailable', 'Grok service is unavailable. Try again later.', 503)
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  generateContent,
  convertGeminiSchemaToJsonSchema,
  aiError,
  safeDiagnostic,
  API_ENDPOINT,
  DEFAULT_MODEL,
}
