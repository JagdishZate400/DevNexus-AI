require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')

function freshConfig(value) {
  if (value === undefined) delete process.env.GEMINI_TIMEOUT_MS
  else process.env.GEMINI_TIMEOUT_MS = value
  delete require.cache[require.resolve('../src/config')]
  return require('../src/config')
}

test('Gemini generation defaults to 90 seconds and preserves environment overrides', () => {
  assert.equal(freshConfig().geminiTimeoutMs, 90000)
  assert.equal(freshConfig('30000').geminiTimeoutMs, 30000)
  assert.equal(freshConfig('60000').geminiTimeoutMs, 60000)
  assert.equal(freshConfig('90000').geminiTimeoutMs, 90000)
})

test('adapter accepts 90 seconds and still rejects unsafe timeout configuration', async () => {
  const config = freshConfig()
  Object.assign(config, { geminiApiKey: 'test-key', geminiModel: 'test-model' })
  delete require.cache[require.resolve('../src/services/gemini')]
  const { generateReply } = require('../src/services/gemini')
  const original = global.fetch
  global.fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] }))
  try {
    assert.equal((await generateReply({ message: 'test' })).reply, 'OK')
    for (const value of [90001, 999, NaN, 1000.5]) {
      config.geminiTimeoutMs = value
      await assert.rejects(generateReply({ message: 'test' }), (err) => err.code === 'ai_configuration')
    }
  } finally { global.fetch = original }
})
