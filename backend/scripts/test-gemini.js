// Run from backend/. Loads server configuration locally; never prints its values.
const { generateReply, analyzeSource, generateContent, API_VERSION } = require('../src/services/gemini')
const config = require('../src/config')

async function main() {
  const started = Date.now()
  const diagnostics = process.argv.includes('--diagnostic')
  const diagnostic = diagnostics ? (data) => console.log(JSON.stringify(data)) : undefined
  if (diagnostics) {
    const info = config.geminiModelInfo
    console.log(JSON.stringify({ apiVersion: API_VERSION,
      model: info.valid ? config.geminiModel : '[invalid model]',
      modelParsing: { whitespaceDetected: info.whitespace, quotesDetected: info.quotes, prefixDetected: info.prefix, valid: info.valid },
      modelSource: Object.hasOwn(process.env, 'GEMINI_MODEL') ? 'effective process environment (dotenv does not override existing values)' : 'missing',
    }))
    const { listModels } = require('./list-gemini-models')
    const names = await listModels()
    console.log(JSON.stringify({ apiVersion: API_VERSION, listedForGenerateContent: names.includes(`models/${config.geminiModel}`) }))
  }
  if (process.argv.includes('--minimal')) {
    await generateContent({ contents: [{ role: 'user', parts: [{ text: 'Reply with CONNECTED.' }] }], diagnostic })
    console.log('Gemini minimal connectivity: PASS')
    return
  }
  await generateReply({ message: 'Reply with CONNECTED.', history: [], diagnostic })
  console.log('Gemini chat connectivity: PASS')
  await analyzeSource({ code: 'const total = 1;', language: 'javascript', file: 'connectivity.js', diagnostic })
  console.log('Gemini structured review connectivity: PASS')
  console.log(`Elapsed: ${Date.now() - started} ms`)
}

main().catch((err) => {
  console.error(`Gemini connectivity: FAIL (${err.safeCode || (err.code?.startsWith('ai_') ? err.code : 'ai_unavailable')})`)
  process.exitCode = 1
})
