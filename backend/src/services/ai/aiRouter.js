/**
 * DevNexus AI — Isolated Multi-Provider AI Router (Gemini-First with Grok Backup)
 *
 * ARCHITECTURE:
 * - Primary provider: Google Gemini (credential pool: up to 2 keys)
 * - Backup provider:  xAI Grok      (credential pool: up to 3 keys)
 *
 * FAILOVER & CIRCUIT BREAKER POLICY:
 * - CLOSED:    Normal state. Outgoing requests routed to primary Gemini pool.
 * - OPEN:      Gemini pool temporarily unavailable (quota 429, consecutive server failures,
 *              or credential exhaustion). Requests routed directly to Grok backup.
 * - HALF_OPEN: Cooldown has elapsed. A single trial probe is dispatched to Gemini.
 *              Concurrent requests during HALF_OPEN do NOT stampede Gemini; they route
 *              to Grok backup while the probe is in flight.
 *
 * CONCURRENCY CONTROL:
 * NOTE: The in-memory concurrency limiter below is process-local state. It throttles
 * simultaneous outgoing AI requests within this single Node.js instance. It does
 * not replace and is distinct from the distributed PostgreSQL review batch queue
 * locks (e.g. pg_advisory_xact_lock(1420136)).
 */

const grokAdapter = require('./grokAdapter')
const config = require('../../config')

const GEMINI_API_VERSION = 'v1beta'
const GEMINI_DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com'
const GROK_DEFAULT_ENDPOINT = grokAdapter.API_ENDPOINT || 'https://api.x.ai/v1/chat/completions'
const MAX_RESPONSE_BYTES = 256000

function isValidGrokModelSyntax(model) {
  if (typeof model !== 'string') return false
  const trimmed = model.trim()
  if (!trimmed || trimmed !== model) return false
  if (/[\s\u200B-\u200D\u2060]/u.test(model)) return false
  return /^[a-zA-Z0-9._/-]{1,120}$/.test(model)
}

function isValidGeminiModel(model) {
  if (typeof model !== 'string') return false
  const trimmed = model.trim()
  if (!trimmed || trimmed !== model) return false
  if (/[\s\u200B-\u200D\u2060]/u.test(model)) return false
  return /^[a-zA-Z0-9._/-]{1,120}$/.test(model)
}

const isSupportedGrokModel = isValidGrokModelSyntax

function aiError(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status })
}

function safeDiagnostic(callback, event) {
  try {
    const result = callback?.(event)
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch {}
}

/**
 * Process-local in-memory concurrency limiter (bounded semaphore queue).
 */
class ConcurrencyLimiter {
  constructor(limit = 8, maxQueue = 100) {
    this.limit = Number.isInteger(limit) && limit > 0 ? limit : 8
    this.maxQueue = Number.isInteger(maxQueue) && maxQueue > 0 ? maxQueue : 100
    this.active = 0
    this.queue = []
  }

  async run(task, { timeoutMs, signal } = {}) {
    if (this.active >= this.limit) {
      if (this.queue.length >= this.maxQueue) {
        throw aiError('ai_unavailable', 'Process AI concurrency queue full. Try again later.', 503)
      }

      await new Promise((resolve, reject) => {
        let timer = null
        let entry = null

        const cleanup = () => {
          if (timer) clearTimeout(timer)
          if (signal) signal.removeEventListener('abort', onAbort)
          const idx = this.queue.indexOf(entry)
          if (idx !== -1) {
            this.queue.splice(idx, 1)
          }
        }

        const onAbort = () => {
          cleanup()
          reject(aiError('ai_timeout', 'Request cancelled while queued.', 504))
        }

        if (signal?.aborted) {
          return reject(aiError('ai_timeout', 'Request already cancelled.', 504))
        }

        if (Number.isInteger(timeoutMs) && timeoutMs > 0) {
          timer = setTimeout(() => {
            cleanup()
            reject(aiError('ai_timeout', 'Request timed out while queued.', 504))
          }, timeoutMs)
        }

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true })
        }

        entry = () => {
          cleanup()
          resolve()
        }

        this.queue.push(entry)
      })
    }

    this.active++
    try {
      return await task()
    } finally {
      this.active--
      if (this.queue.length > 0) {
        const next = this.queue.shift()
        next()
      }
    }
  }

  getMetrics() {
    return {
      active: this.active,
      queued: this.queue.length,
      limit: this.limit,
    }
  }
}

/**
 * Deterministic circuit breaker state machine for Gemini primary pool.
 */
class CircuitBreaker {
  constructor({ cooldownMs = 60000, failureThreshold = 2, now = Date.now } = {}) {
    this.cooldownMs = Number.isInteger(cooldownMs) && cooldownMs > 0 ? cooldownMs : 60000
    this.failureThreshold = Number.isInteger(failureThreshold) && failureThreshold > 0 ? failureThreshold : 2
    this.now = typeof now === 'function' ? now : Date.now
    this.state = 'CLOSED' // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.openedAt = 0
    this.effectiveCooldownMs = this.cooldownMs
    this.consecutiveFailures = 0
    this.probeInFlight = false
  }

  getState() {
    if (this.state === 'OPEN') {
      const elapsed = this.now() - this.openedAt
      if (elapsed >= this.effectiveCooldownMs) {
        this.state = 'HALF_OPEN'
      }
    }
    return this.state
  }

  recordSuccess() {
    this.state = 'CLOSED'
    this.consecutiveFailures = 0
    this.probeInFlight = false
    this.openedAt = 0
    this.effectiveCooldownMs = this.cooldownMs
  }

  recordFailure({ isQuota = false, retryAfterSeconds = null } = {}) {
    this.consecutiveFailures++
    this.probeInFlight = false
    if (isQuota || this.consecutiveFailures >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN'
      this.openedAt = this.now()
      this.effectiveCooldownMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : this.cooldownMs
    }
  }

  acquireProbe() {
    const currentState = this.getState()
    if (currentState === 'HALF_OPEN' && !this.probeInFlight) {
      this.probeInFlight = true
      return true
    }
    return false
  }

  releaseProbe() {
    this.probeInFlight = false
  }

  reset() {
    this.state = 'CLOSED'
    this.openedAt = 0
    this.effectiveCooldownMs = this.cooldownMs
    this.consecutiveFailures = 0
    this.probeInFlight = false
  }
}

/**
 * Safely bounds and reads a fetch response stream without logging upstream bodies.
 */
async function readResponseBody(res, maxBytes = MAX_RESPONSE_BYTES) {
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
        if (bytes > maxBytes) {
          await reader.cancel().catch(() => {})
          throw aiError('ai_malformed_response', 'Gemini response exceeded output limit.')
        }
        raw += decoder.decode(value, { stream: true })
      }
      raw += decoder.decode()
    } finally {
      reader.releaseLock?.()
    }
  } else if (typeof res.text === 'function') {
    raw = await res.text()
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
      throw aiError('ai_malformed_response', 'Gemini response exceeded output limit.')
    }
  } else {
    throw aiError('ai_malformed_response', 'Gemini response body is unreadable.')
  }

  return raw
}

/**
 * Dispatches an isolated request to Google Gemini REST API.
 */
async function callGemini({
  apiKey,
  model = 'gemini-1.5-flash',
  system,
  contents,
  json = false,
  responseSchema,
  diagnostic,
  timeoutMs = 60000,
  fetchClient = globalThis.fetch,
  endpointBase = GEMINI_DEFAULT_ENDPOINT,
  apiVersion = GEMINI_API_VERSION,
  keyIndex = 0,
  now = Date.now,
}) {
  let httpStatus = null
  let requestBytes = 0
  let phase = 'request_preparation'
  const started = now()

  const report = (category, diagnosticCategory = category) => {
    safeDiagnostic(diagnostic, {
      provider: 'gemini',
      keyIndex,
      model: typeof model === 'string' && /^[a-zA-Z0-9._/-]{1,120}$/.test(model) ? model : '[invalid model]',
      httpStatus,
      category,
      diagnosticCategory,
      phase,
      elapsedMs: now() - started,
      requestBytes,
    })
  }

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    const err = aiError('ai_configuration', 'Gemini requires a valid server API key.', 503)
    report('ai_configuration', 'missing_api_key')
    throw err
  }

  if (typeof model !== 'string' || !/^[a-zA-Z0-9._/-]{1,120}$/.test(model)) {
    const err = aiError('ai_configuration', 'Invalid Gemini model identifier.', 503)
    report('ai_configuration', 'invalid_model')
    throw err
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    const err = aiError('ai_configuration', 'Invalid Gemini request timeout budget (must be 1-120000 ms).', 503)
    report('ai_configuration', 'invalid_timeout')
    throw err
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const generationConfig = {
      temperature: 0.2,
      maxOutputTokens: json || responseSchema ? 4096 : 2048,
      candidateCount: 1,
    }

    if (json || responseSchema) {
      generationConfig.responseMimeType = 'application/json'
      if (responseSchema) {
        generationConfig.responseSchema = responseSchema
      }
    }

    let formattedContents = contents
    if (typeof contents === 'string') {
      formattedContents = [{ role: 'user', parts: [{ text: contents }] }]
    } else if (Array.isArray(contents)) {
      formattedContents = contents.map((item) => {
        if (!item) return { role: 'user', parts: [{ text: '' }] }
        const role = item.role === 'assistant' || item.role === 'model' ? 'model' : 'user'
        if (Array.isArray(item.parts)) {
          return { role, parts: item.parts }
        }
        const text = typeof item.content === 'string' ? item.content : typeof item.text === 'string' ? item.text : ''
        return { role, parts: [{ text }] }
      })
    }

    const payload = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: formattedContents,
      generationConfig,
    }

    const serializedBody = JSON.stringify(payload)
    requestBytes = Buffer.byteLength(serializedBody, 'utf8')

    phase = 'fetch'
    const targetUrl = `${endpointBase.replace(/\/$/, '')}/${apiVersion}/models/${model}:generateContent`
    const res = await fetchClient(targetUrl, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: serializedBody,
    })

    httpStatus = res.status
    phase = 'http_response'

    if (!res.ok) {
      if ([401, 403].includes(res.status)) {
        throw aiError('ai_authentication', 'Gemini API key is invalid or lacks access.', 503)
      }
      if (res.status === 429) {
        const error = aiError('ai_quota', 'Gemini quota or rate limit exceeded. Try again later.', 429)
        const header = res.headers?.get?.('retry-after')
        const seconds = header && /^\d+$/.test(header)
          ? Number(header)
          : header
            ? Math.ceil((Date.parse(header) - now()) / 1000)
            : 60
        error.retryAfterSeconds = Number.isFinite(seconds) ? Math.max(60, Math.min(3600, seconds)) : 60
        throw error
      }
      if (res.status === 400) {
        throw aiError('ai_request_rejected', 'Gemini rejected the request. Check model configuration.', 503)
      }
      if (res.status === 404) {
        throw aiError('ai_model_unavailable', 'Gemini resource or model not found for this API version.', 503)
      }
      throw aiError('ai_unavailable', 'Gemini service is unavailable. Try again later.', 503)
    }

    phase = 'response_stream'
    const rawBody = await readResponseBody(res)

    phase = 'response_validation'
    let data
    try {
      data = JSON.parse(rawBody)
    } catch {
      throw aiError('ai_malformed_response', 'Gemini returned an invalid response body.')
    }

    const candidate = data?.candidates?.[0]
    if (data?.promptFeedback?.blockReason || (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason))) {
      throw aiError('ai_blocked', 'Gemini could not provide output for this request due to content policy.', 422)
    }

    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw aiError('ai_output_limit', 'Gemini output was incomplete. Try a smaller request.')
    }

    if (candidate?.finishReason !== 'STOP') {
      throw aiError('ai_malformed_response', 'Gemini returned an invalid completion.')
    }

    const parts = candidate?.content?.parts
    const text = Array.isArray(parts)
      ? parts.filter((p) => p && !p.thought && typeof p.text === 'string').map((p) => p.text).join('').trim()
      : ''

    if (!text || text.length > 32000) {
      throw aiError('ai_malformed_response', 'Gemini returned empty or invalid output.')
    }

    phase = 'generation_completed'
    report('ok', 'generation_success')

    const result = {
      text,
      provider: 'gemini',
      model,
    }

    if (data.usageMetadata && typeof data.usageMetadata === 'object') {
      result.usage = {
        promptTokens: Number.isInteger(data.usageMetadata.promptTokenCount) ? data.usageMetadata.promptTokenCount : 0,
        completionTokens: Number.isInteger(data.usageMetadata.candidatesTokenCount) ? data.usageMetadata.candidatesTokenCount : 0,
        totalTokens: Number.isInteger(data.usageMetadata.totalTokenCount) ? data.usageMetadata.totalTokenCount : 0,
      }
    }

    return result
  } catch (err) {
    const isTimeout = controller.signal.aborted || err.name === 'AbortError'
    const category = isTimeout ? 'ai_timeout' : err.code?.startsWith('ai_') ? err.code : 'ai_unavailable'
    const reason = isTimeout ? 'gemini_timeout' : phase === 'http_response' ? `http_${httpStatus}` : category
    report(category, reason)

    if (isTimeout) {
      throw aiError('ai_timeout', 'Gemini request timed out. Try again.', 504)
    }
    if (err.code?.startsWith('ai_')) {
      throw err
    }
    throw aiError('ai_unavailable', 'Gemini service is unavailable. Try again later.', 503)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Isolated multi-provider AI Router.
 */
class AiRouter {
  constructor(options = {}) {
    this.geminiKeys = this._resolveGeminiKeys(options.geminiKeys)
    this.grokKeys = this._resolveGrokKeys(options.grokKeys)

    if (options.geminiModel !== undefined && !isValidGeminiModel(options.geminiModel)) {
      throw aiError('ai_configuration', 'Gemini model configuration is missing or invalid.', 503)
    }

    if (options.grokModel !== undefined && options.grokModel !== '' && !isValidGrokModelSyntax(options.grokModel)) {
      throw aiError('ai_configuration', `Invalid Grok model identifier syntax: "${options.grokModel}".`, 503)
    }

    this.geminiModel = (typeof options.geminiModel === 'string' && options.geminiModel.trim())
      ? options.geminiModel.trim()
      : (config.geminiModel || (process.env.GEMINI_MODEL ? process.env.GEMINI_MODEL.trim() : 'gemini-1.5-flash'))

    this.grokModel = (typeof options.grokModel === 'string' && options.grokModel.trim())
      ? options.grokModel.trim()
      : (options.grokModel === '' ? '' : (config.grokModel || (process.env.GROK_MODEL ? process.env.GROK_MODEL.trim() : '')))

    this.defaultTimeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : (config.geminiTimeoutMs || 60000)

    this.fetchClient = typeof options.fetchClient === 'function' ? options.fetchClient : globalThis.fetch
    this.now = typeof options.now === 'function' ? options.now : Date.now
    this.geminiEndpoint = options.geminiEndpoint || GEMINI_DEFAULT_ENDPOINT
    this.grokEndpoint = options.grokEndpoint || GROK_DEFAULT_ENDPOINT

    this.geminiDisabledKeys = new Set()
    this.grokDisabledKeys = new Set()

    this.circuitBreaker = new CircuitBreaker({
      cooldownMs: options.cooldownMs ?? 60000,
      failureThreshold: options.failureThreshold ?? 2,
      now: this.now,
    })

    this.concurrencyLimiter = new ConcurrencyLimiter(
      options.concurrencyLimit ?? 8,
      options.maxQueueSize ?? 100
    )
  }

  _resolveGeminiKeys(explicitKeys) {
    if (Array.isArray(explicitKeys)) {
      return explicitKeys
        .map((k) => (typeof k === 'string' ? k.trim() : ''))
        .filter(Boolean)
        .slice(0, 2)
    }

    const primary = (
      process.env.GEMINI_API_KEY ||
      config.geminiApiKey ||
      ''
    ).trim()

    const secondary = (
      process.env.GEMINI_API_KEY_2 ||
      config.geminiApiKey2 ||
      ''
    ).trim()

    const keys = []
    if (primary) keys.push(primary)
    if (secondary && !keys.includes(secondary)) keys.push(secondary)
    return keys
  }

  _resolveGrokKeys(explicitKeys) {
    if (Array.isArray(explicitKeys)) {
      return explicitKeys
        .map((k) => (typeof k === 'string' ? k.trim() : ''))
        .filter(Boolean)
        .slice(0, 3)
    }

    // Deterministic precedence: GROK_API_KEY_1 (preferred primary) > GROK_API_KEY > XAI_API_KEY
    const primary = (
      process.env.GROK_API_KEY_1 ||
      process.env.GROK_API_KEY ||
      process.env.XAI_API_KEY ||
      config.grokApiKey1 ||
      config.grokApiKey ||
      ''
    ).trim()

    const secondary = (
      process.env.GROK_API_KEY_2 ||
      config.grokApiKey2 ||
      ''
    ).trim()

    const tertiary = (
      process.env.GROK_API_KEY_3 ||
      config.grokApiKey3 ||
      ''
    ).trim()

    const keys = []
    if (primary) keys.push(primary)
    if (secondary && !keys.includes(secondary)) keys.push(secondary)
    if (tertiary && !keys.includes(tertiary)) keys.push(tertiary)
    return keys
  }

  _getNextGeminiKey() {
    for (let i = 0; i < this.geminiKeys.length; i++) {
      if (!this.geminiDisabledKeys.has(i)) {
        return { key: this.geminiKeys[i], index: i }
      }
    }
    return null
  }

  _getNextGrokKey() {
    for (let i = 0; i < this.grokKeys.length; i++) {
      if (!this.grokDisabledKeys.has(i)) {
        return { key: this.grokKeys[i], index: i }
      }
    }
    return null
  }

  getCircuitState() {
    return this.circuitBreaker.getState()
  }

  getMetrics() {
    return {
      circuitState: this.circuitBreaker.getState(),
      consecutiveGeminiFailures: this.circuitBreaker.consecutiveFailures,
      geminiKeyCount: this.geminiKeys.length,
      geminiActiveKeyCount: this.geminiKeys.length - this.geminiDisabledKeys.size,
      grokKeyCount: this.grokKeys.length,
      grokActiveKeyCount: this.grokKeys.length - this.grokDisabledKeys.size,
      concurrency: this.concurrencyLimiter.getMetrics(),
    }
  }

  reset() {
    this.geminiDisabledKeys.clear()
    this.grokDisabledKeys.clear()
    this.circuitBreaker.reset()
  }

  async generateContent({
    system,
    contents,
    json = false,
    responseSchema,
    structuredMode = 'json_object',
    diagnostic,
    timeoutMs,
    signal,
  }) {
    const totalBudget = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.defaultTimeoutMs
    return this.concurrencyLimiter.run(async () => {
      const started = this.now()
      const deadline = started + totalBudget

      // Check if any credentials exist across both providers
      if (this.geminiKeys.length === 0 && this.grokKeys.length === 0) {
        throw aiError('ai_configuration', 'No AI providers configured.', 503)
      }

      // Model configuration checks
      if (this.geminiKeys.length > 0 && !isValidGeminiModel(this.geminiModel)) {
        throw aiError('ai_configuration', 'Gemini model configuration is missing or invalid.', 503)
      }
      if (this.grokKeys.length > 0 && !isValidGrokModelSyntax(this.grokModel)) {
        throw aiError('ai_configuration', 'Grok model configuration is missing or invalid. An explicit GROK_MODEL is required when Grok backup is enabled.', 503)
      }

      let previousGeminiError = null
      let cbState = this.circuitBreaker.getState()
      let geminiCandidate = this._getNextGeminiKey()

      // Determine if Gemini can be attempted on this invocation
      let canAttemptGemini = false
      let isRecoveryProbe = false

      if (geminiCandidate && cbState === 'CLOSED') {
        canAttemptGemini = true
      } else if (geminiCandidate && cbState === 'HALF_OPEN') {
        if (this.circuitBreaker.acquireProbe()) {
          canAttemptGemini = true
          isRecoveryProbe = true
        }
      }

      // --- PRIMARY PROVIDER: GEMINI ---
      if (canAttemptGemini) {
        while (geminiCandidate) {
          const remainingForGemini = deadline - this.now()
          if (remainingForGemini < 1000) {
            if (isRecoveryProbe) this.circuitBreaker.releaseProbe()
            throw aiError('ai_timeout', 'Gemini request timed out before execution.', 504)
          }

          try {
            const geminiRes = await callGemini({
              apiKey: geminiCandidate.key,
              model: this.geminiModel,
              system,
              contents,
              json,
              responseSchema,
              diagnostic,
              timeoutMs: remainingForGemini,
              fetchClient: this.fetchClient,
              endpointBase: this.geminiEndpoint,
              keyIndex: geminiCandidate.index,
              now: this.now,
            })

            // Successful generation resets circuit breaker to CLOSED
            this.circuitBreaker.recordSuccess()
            return {
              text: geminiRes.text,
              provider: 'gemini',
              model: this.geminiModel,
              keyIndex: geminiCandidate.index,
              usage: geminiRes.usage,
            }
          } catch (err) {
            previousGeminiError = err

            // 1. Client / Bad Request (HTTP 400): fail closed immediately, no rotation, no failover
            if (err.code === 'ai_request_rejected') {
              if (isRecoveryProbe) this.circuitBreaker.releaseProbe()
              throw err
            }

            // 2. Configuration or Invalid Model failure: fail closed immediately, do not silently hide with Grok failover
            if (err.code === 'ai_configuration' || err.code === 'ai_model_unavailable') {
              if (isRecoveryProbe) this.circuitBreaker.releaseProbe()
              throw err
            }

            // 3. Credential-specific failure (401 / 403): disable this key and rotate within Gemini pool
            if (err.code === 'ai_authentication') {
              this.geminiDisabledKeys.add(geminiCandidate.index)
              const nextKey = this._getNextGeminiKey()
              if (nextKey) {
                geminiCandidate = nextKey
                continue // retry immediately with next Gemini key
              }
              // Gemini keys exhausted
              this.circuitBreaker.recordFailure()
              break
            }

            // 4. Shared quota / rate limit (429): trip circuit breaker immediately, do NOT rotate Gemini keys
            if (err.code === 'ai_quota') {
              this.circuitBreaker.recordFailure({
                isQuota: true,
                retryAfterSeconds: err.retryAfterSeconds,
              })
              break // fail over to Grok
            }

            // 5. Transient server failures (502/503/504) or timeout:
            // Record failure against circuit breaker and prepare for Grok failover
            this.circuitBreaker.recordFailure()
            break
          }
        }
      }

      // --- SECONDARY PROVIDER: GROK FAILOVER ---
      // Check remaining deadline budget before secondary failover
      const remainingForGrok = deadline - this.now()
      if (remainingForGrok < 1000) {
        throw aiError('ai_timeout', 'AI request deadline exhausted; secondary failover aborted.', 504)
      }

      // If no Grok keys configured, surface the sanitized Gemini error
      if (this.grokKeys.length === 0) {
        if (previousGeminiError) throw previousGeminiError
        throw aiError('ai_unavailable', 'Primary AI provider unavailable and no backup configured.', 503)
      }

      // Attempt Grok pool with credential rotation for 401/403
      let grokCandidate = this._getNextGrokKey()
      if (!grokCandidate) {
        if (previousGeminiError) throw previousGeminiError
        throw aiError('ai_unavailable', 'All AI providers are exhausted or unavailable.', 503)
      }

      while (grokCandidate) {
        const currentGrokRemaining = deadline - this.now()
        if (currentGrokRemaining < 1000) {
          throw aiError('ai_timeout', 'Grok failover deadline exhausted.', 504)
        }

        const grokDiagnosticRelay = diagnostic
          ? (event) => safeDiagnostic(diagnostic, { ...event, keyIndex: grokCandidate.index })
          : undefined

        try {
          const grokRes = await grokAdapter.generateContent({
            apiKey: grokCandidate.key,
            model: this.grokModel,
            system,
            contents,
            json,
            responseSchema,
            structuredMode,
            diagnostic: grokDiagnosticRelay,
            timeoutMs: currentGrokRemaining,
            fetchClient: this.fetchClient,
            endpoint: this.grokEndpoint,
          })

          return {
            text: grokRes.text,
            provider: 'grok',
            model: this.grokModel,
            keyIndex: grokCandidate.index,
            usage: grokRes.usage,
          }
        } catch (gErr) {
          // Configuration, invalid model, or 400 rejection on Grok fails closed immediately
          if (gErr.code === 'ai_configuration' || gErr.code === 'ai_model_unavailable' || gErr.code === 'ai_request_rejected') {
            throw gErr
          }

          // If Grok key is invalid (401/403), rotate to next Grok key
          if (gErr.code === 'ai_authentication') {
            this.grokDisabledKeys.add(grokCandidate.index)
            grokCandidate = this._getNextGrokKey()
            if (grokCandidate) {
              continue
            }
          }

          // If all Grok keys exhausted or error is non-auth (e.g. 429, 503), throw sanitized error
          if (previousGeminiError && previousGeminiError.code === 'ai_quota' && gErr.code !== 'ai_quota') {
            throw previousGeminiError
          }
          throw gErr
        }
      }

      // If loop exited without return, all providers are exhausted
      throw aiError('ai_unavailable', 'All AI providers are unavailable.', 503)
    }, { timeoutMs: totalBudget, signal })
  }
}

function createAiRouter(options = {}) {
  return new AiRouter(options)
}

const defaultRouter = createAiRouter()

module.exports = {
  createAiRouter,
  AiRouter,
  generateContent: (args) => defaultRouter.generateContent(args),
  getCircuitState: () => defaultRouter.getCircuitState(),
  getMetrics: () => defaultRouter.getMetrics(),
  reset: () => defaultRouter.reset(),
  aiError,
  safeDiagnostic,
  GEMINI_DEFAULT_ENDPOINT,
  GROK_DEFAULT_ENDPOINT,
  isValidGrokModelSyntax,
  isSupportedGrokModel,
  isValidGeminiModel,
}
