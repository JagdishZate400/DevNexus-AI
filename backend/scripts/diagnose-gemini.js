// Temporary opt-in diagnostic. No application configuration is changed.
const config = require('../src/config')

const STATUSES = new Set(['INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DEADLINE_EXCEEDED'])

async function inspectResponse(res) {
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  // Print an allowlisted media type, never arbitrary header values.
  const contentType = ['application/json', 'text/html', 'text/plain', 'application/problem+json'].includes(type) ? type : 'other-or-missing'
  const reader = res.body?.getReader()
  let raw = '', bytes = 0
  const decoder = new TextDecoder()
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 2000000) { await reader.cancel(); return { contentType, responseFormat: 'oversized', googleErrorStatus: null } }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
  }
  let data
  try { data = JSON.parse(raw) } catch { return { contentType, responseFormat: 'non-json', googleErrorStatus: null } }
  const error = data?.error
  const standard = contentType === 'application/json' && error && typeof error === 'object' &&
    error.code === res.status && typeof error.message === 'string' && STATUSES.has(error.status)
  return {
    contentType,
    responseFormat: standard ? 'google-compatible-json-error' : res.ok && data && typeof data === 'object' ? 'json-success' : 'nonstandard-json-error',
    googleErrorStatus: standard ? error.status : null,
  }
}

async function probe(apiVersion, operation) {
  const model = /^[a-zA-Z0-9._-]+$/.test(config.geminiModel) ? config.geminiModel : null
  const method = operation === 'list' ? 'GET' : 'POST'
  const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models${operation === 'list' ? '?pageSize=1000' : `/${model}:generateContent`}`
  const base = { apiVersion, operation, model: model || '[invalid model]', method, endpoint }
  if (!model || !config.geminiApiKey || !Number.isInteger(config.geminiTimeoutMs) || config.geminiTimeoutMs < 1000 || config.geminiTimeoutMs > 90000) {
    return { ...base, endpoint: '[configuration invalid]', httpStatus: null, category: 'ai_configuration' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.geminiTimeoutMs)
  let httpStatus = null
  try {
    const res = await fetch(endpoint, {
      method, redirect: 'error', signal: controller.signal,
      headers: { 'x-goog-api-key': config.geminiApiKey, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      // Smallest official text request: no system prompt, schema or tools.
      ...(method === 'POST' ? { body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }] }) } : {}),
    })
    httpStatus = res.status
    const info = await inspectResponse(res)
    const category = res.ok ? 'ok' : info.googleErrorStatus ? `google_${info.googleErrorStatus.toLowerCase()}` : 'nonstandard_http_error_origin_unverified'
    return { ...base, httpStatus, ...info, category }
  } catch {
    return { ...base, httpStatus, contentType: 'unknown', category: controller.signal.aborted ? 'ai_timeout' : 'ai_network' }
  } finally { clearTimeout(timer) }
}

async function main() {
  for (const version of ['v1beta', ...(process.argv.includes('--compare-v1') ? ['v1'] : [])]) {
    for (const operation of ['list', 'generate']) {
      const result = await probe(version, operation)
      console.log(JSON.stringify(result))
      if (result.category !== 'ok') process.exitCode = 1
    }
  }
}
if (require.main === module) main().catch(() => { console.error('Gemini diagnostic failed (ai_diagnostic_failure)'); process.exitCode = 1 })
module.exports = { inspectResponse, probe }
