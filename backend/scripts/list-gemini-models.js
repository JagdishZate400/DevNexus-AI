// Run from backend/. Only model names are written to stdout.
// Load configuration quietly: dotenv must not print environment diagnostics.
const config = require('../src/config')
const { API_VERSION } = require('../src/services/gemini')

function fail(code, message) {
  return Object.assign(new Error(message), { safeCode: code })
}

async function listModels() {
  const apiKey = config.geminiApiKey
  const timeoutMs = config.geminiTimeoutMs
  if (!apiKey || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 90000) {
    throw fail('ai_configuration', 'Set a server API key and a timeout between 1000 and 90000 ms.')
  }
  const controller = new AbortController()
  // One deadline covers all pages, including response-body reads.
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const names = new Set()
  const tokens = new Set()
  let pageToken = ''
  try {
    for (let page = 0; page < 100; page++) {
      const url = new URL(`https://generativelanguage.googleapis.com/${API_VERSION}/models`)
      url.searchParams.set('pageSize', '1000')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const res = await fetch(url, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { 'x-goog-api-key': apiKey },
      })
      if (!res.ok) {
        // Invalid keys can also produce HTTP 400. Do not expose provider bodies.
        if ([401, 403].includes(res.status)) throw fail('ai_authentication', 'API key is invalid or lacks access.')
        if (res.status === 400) throw fail('ai_request_rejected', 'API request rejected. Check the server API key and configuration.')
        if (res.status === 429) throw fail('ai_quota', 'Quota or rate limit exceeded. Try again later.')
        throw fail('ai_api_failure', 'Gemini API request failed. Try again later.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let raw = '', bytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 2000000) {
          await reader.cancel()
          throw fail('ai_malformed_response', 'Model listing exceeded the response limit.')
        }
        raw += decoder.decode(value, { stream: true })
      }
      raw += decoder.decode()
      let data
      try { data = JSON.parse(raw) } catch { throw fail('ai_malformed_response', 'Invalid model listing response.') }
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
          (data.models !== undefined && !Array.isArray(data.models))) {
        throw fail('ai_malformed_response', 'Invalid model listing response.')
      }
      for (const model of data.models || []) {
        if (!model || !/^models\/[a-zA-Z0-9._-]+$/.test(model.name) ||
            typeof model.name !== 'string' || model.name.length > 200 ||
            !Array.isArray(model.supportedGenerationMethods)) {
          throw fail('ai_malformed_response', 'Invalid model listing response.')
        }
        if (model.supportedGenerationMethods.includes('generateContent')) names.add(model.name)
      }
      if (!data.nextPageToken) return [...names].sort()
      if (typeof data.nextPageToken !== 'string' || data.nextPageToken.length > 4096 || tokens.has(data.nextPageToken)) {
        throw fail('ai_malformed_response', 'Invalid model listing pagination.')
      }
      pageToken = data.nextPageToken
      tokens.add(pageToken)
    }
    throw fail('ai_malformed_response', 'Model listing exceeded the pagination limit.')
  } catch (err) {
    if (controller.signal.aborted) throw fail('ai_timeout', 'Model listing timed out. Try again.')
    if (err.safeCode) throw err
    throw fail('ai_network', 'Could not connect to the Gemini API. Check network connectivity.')
  } finally { clearTimeout(timer) }
}

if (require.main === module) {
  listModels().then((names) => {
    for (const name of names) console.log(name)
    if (!names.length) {
      console.error('Gemini model listing: no models supporting generateContent were returned.')
      process.exitCode = 1
    }
  }).catch((err) => {
    console.error(`Gemini model listing: FAIL (${err.safeCode || 'ai_api_failure'}): ${err.safeCode ? err.message : 'API request failed.'}`)
    process.exitCode = 1
  })
}

module.exports = { listModels }
