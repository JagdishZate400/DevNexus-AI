require('./helpers/offline')
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const config = require('../src/config')
Object.assign(config, {
  aiProvider: 'gemini',
  geminiApiKey: 'test-key',
  geminiModel: 'gemini-3.1-flash-lite',
  geminiTimeoutMs: 5000,
})

const {
  extractSearchTerms,
  retrieve,
  generateRepositoryReply,
  UNVERIFIED,
} = require('../src/services/repositoryChat')

const mockUtilsChunk = {
  id: 'chunk-utils-01',
  chunkId: 'chunk-utils-01',
  fileId: crypto.randomUUID(),
  projectId: 'smart-campus-management-system-ba18e773',
  path: 'DevNexus-Upload-Test/utils.js',
  startLine: 1,
  endLine: 8,
  startColumn: 1,
  endColumn: 1,
  rank: 1.0,
  snippet: 'function add(a, b) {\n  return a + b;\n}\n\nfunction multiply(a, b) {\n  return a * b;\n}\n\nmodule.exports = { add, multiply };\n',
}

const mockAppChunk = {
  id: 'chunk-app-01',
  chunkId: 'chunk-app-01',
  fileId: crypto.randomUUID(),
  projectId: 'smart-campus-management-system-ba18e773',
  path: 'DevNexus-Upload-Test/app.js',
  startLine: 1,
  endLine: 12,
  startColumn: 1,
  endColumn: 1,
  rank: 0.9,
  snippet: 'const { add, multiply } = require("./utils");\n\nfunction calculateGrade(score, weight) {\n  return multiply(score, weight);\n}\n',
}

function createMockReq(customChunks = [mockUtilsChunk, mockAppChunk], ownerId = 'user-owner-123') {
  const queryLog = []
  return {
    queryLog,
    app: {
      locals: {
        sourceRepository: {
          async findProject(projectId, userId) {
            if (projectId === 'smart-campus-management-system-ba18e773' && userId === ownerId) {
              return { id: projectId, name: 'Smart Campus Management System', owner_id: ownerId }
            }
            return null
          },
          async searchSource(projectId, userId, term, limit) {
            queryLog.push({ projectId, userId, term, limit })
            const termLower = term.toLowerCase()
            return customChunks.filter((chunk) => {
              const matchesSnippet = chunk.snippet.toLowerCase().includes(termLower)
              const matchesPath = chunk.path.toLowerCase().includes(termLower)
              return matchesSnippet || matchesPath
            })
          },
        },
      },
    },
    user: { sub: ownerId, email: 'owner@example.com', role: 'Developer' },
  }
}

async function withMockFetch(handler, run) {
  const originalFetch = global.fetch
  global.fetch = handler
  try {
    await run()
  } finally {
    global.fetch = originalFetch
  }
}

function answerPayload(obj) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify(obj) }] },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

// -------------------------------------------------------------
// 1. Term Extraction Tests
// -------------------------------------------------------------
test('extractSearchTerms extracts function calls and code identifiers from short query', () => {
  const terms = extractSearchTerms('What does greet(name) do?')
  assert.ok(terms.includes('greet'), 'Should include function name greet')
  assert.ok(terms.includes('name'), 'Should include argument name name')
})

test('extractSearchTerms preserves code identifiers despite extensive English preamble in long query', () => {
  const longQuery =
    'Please provide a comprehensive and detailed technical analysis of the mathematics utilities module, ' +
    'specifically examining the architecture, design patterns, performance implications, and practical usage ' +
    'of both the add(a, b) and multiply(a, b) functions in utils.js.'

  const terms = extractSearchTerms(longQuery)

  // Critical fix verification: add, multiply, and utils must be present
  assert.ok(terms.includes('add'), 'Should include add')
  assert.ok(terms.includes('multiply'), 'Should include multiply')
  assert.ok(terms.includes('utils'), 'Should include utils')
  assert.ok(terms.includes('js'), 'Should include js')

  // Code symbols (function calls, file names) must appear before low-priority words
  const addIdx = terms.indexOf('add')
  const multIdx = terms.indexOf('multiply')
  assert.ok(addIdx >= 0 && addIdx < 5, `add was at index ${addIdx}, expected priority placement`)
  assert.ok(multIdx >= 0 && multIdx < 5, `multiply was at index ${multIdx}, expected priority placement`)
})

test('extractSearchTerms extracts backticked and quoted tokens with priority', () => {
  const terms = extractSearchTerms('Explain how `calculateTotal` interacts with \'cart.service.js\' and "PaymentGateway"')
  assert.ok(terms.includes('calculateTotal'))
  assert.ok(terms.includes('cart'))
  assert.ok(terms.includes('service'))
  assert.ok(terms.includes('PaymentGateway'))
})

test('extractSearchTerms handles edge cases safely', () => {
  assert.deepEqual(extractSearchTerms(null), [])
  assert.deepEqual(extractSearchTerms(undefined), [])
  assert.deepEqual(extractSearchTerms(123), [])
  assert.deepEqual(extractSearchTerms(''), [])
  assert.deepEqual(extractSearchTerms('what how why is are the of to and'), [])
})

// -------------------------------------------------------------
// 2. Retrieval Logic Tests
// -------------------------------------------------------------
test('retrieve: short query retrieves matching utils chunk', async () => {
  const req = createMockReq()
  const results = await retrieve(req, 'smart-campus-management-system-ba18e773', 'What does add(a, b) do?')

  assert.ok(results.length >= 1, 'Expected at least 1 retrieved chunk')
  assert.equal(results[0].path, 'DevNexus-Upload-Test/utils.js')
  assert.equal(results[0].citationId, 'S1')
  assert.ok(results[0].snippet.includes('function add(a, b)'))
})

test('retrieve: long query with descriptive preamble retrieves utils chunk without truncation', async () => {
  const req = createMockReq()
  const longQuery =
    'Please provide a comprehensive and detailed technical analysis of the mathematics utilities module, ' +
    'specifically examining the architecture, design patterns, performance implications, and practical usage ' +
    'of both the add(a, b) and multiply(a, b) functions in utils.js.'

  const results = await retrieve(req, 'smart-campus-management-system-ba18e773', longQuery)

  assert.ok(results.length >= 1, 'Expected chunks retrieved for long multi-function query')
  const utilsResult = results.find((r) => r.path === 'DevNexus-Upload-Test/utils.js')
  assert.ok(utilsResult, 'Expected utils.js chunk to be retrieved')
  assert.ok(utilsResult.snippet.includes('add'))
  assert.ok(utilsResult.snippet.includes('multiply'))
})

test('retrieve: cross-file multi-function query retrieves both app.js and utils.js', async () => {
  const req = createMockReq()
  const crossFileQuery = 'How does calculateGrade in app.js use multiply from utils.js?'

  const results = await retrieve(req, 'smart-campus-management-system-ba18e773', crossFileQuery)

  assert.ok(results.length >= 2, 'Expected chunks from both files')
  const paths = results.map((r) => r.path)
  assert.ok(paths.includes('DevNexus-Upload-Test/app.js'), 'Expected app.js chunk')
  assert.ok(paths.includes('DevNexus-Upload-Test/utils.js'), 'Expected utils.js chunk')
})

test('retrieve: missing symbol query returns empty chunk array', async () => {
  const req = createMockReq()
  const results = await retrieve(req, 'smart-campus-management-system-ba18e773', 'Explain nonExistentHelperFunction()')
  assert.deepEqual(results, [], 'Missing symbol should retrieve 0 chunks')
})

test('retrieve: verifies project ownership and user isolation', async () => {
  const req = createMockReq([], 'user-owner-123')
  // Try retrieving as different user
  req.user.sub = 'attacker-user-999'

  await assert.rejects(
    async () => {
      await retrieve(req, 'smart-campus-management-system-ba18e773', 'What does add do?')
    },
    (err) => {
      assert.equal(err.code, 'not_found')
      return true
    }
  )
})

test('retrieve: validates and drops malformed or oversized snippets', async () => {
  const corruptedChunks = [
    { ...mockUtilsChunk, snippet: 'x'.repeat(10000) }, // Oversized snippet (>8000 bytes)
    { ...mockAppChunk, startLine: -5 }, // Invalid negative startLine
  ]
  const req = createMockReq(corruptedChunks)
  const results = await retrieve(req, 'smart-campus-management-system-ba18e773', 'add and calculate')
  assert.deepEqual(results, [], 'Corrupted chunks must be safely excluded')
})

// -------------------------------------------------------------
// 3. End-to-End Chat Flow Regression Tests
// -------------------------------------------------------------
test('generateRepositoryReply: long technical query successfully generates verified response with citations', async () => {
  const req = createMockReq()
  let fetchCalled = false

  await withMockFetch(async (url, opts) => {
    fetchCalled = true
    const parsedBody = JSON.parse(opts.body)
    const userPrompt = JSON.parse(parsedBody.contents.at(-1).parts[0].text)

    // Verify chunks were passed to Gemini
    assert.ok(userPrompt.untrustedSourceChunks.length >= 1)
    const utilsChunk = userPrompt.untrustedSourceChunks.find((c) => c.path === 'DevNexus-Upload-Test/utils.js')
    assert.ok(utilsChunk)

    return answerPayload({
      answer:
        '### Technical Analysis of Mathematics Utilities\n\n' +
        '#### `add(a, b)`\n' +
        'Computes the arithmetic sum of operands `a` and `b` [S1].\n\n' +
        '#### `multiply(a, b)`\n' +
        'Computes the arithmetic product of operands `a` and `b` [S1].\n\n' +
        'Both functions are exported as part of the common module [S1].',
      verified: true,
      citationIds: ['S1'],
    })
  }, async () => {
    const longQuery =
      'Please provide a comprehensive and detailed technical analysis of the mathematics utilities module, ' +
      'specifically examining the architecture, design patterns, performance implications, and practical usage ' +
      'of both the add(a, b) and multiply(a, b) functions in utils.js.'

    const response = await generateRepositoryReply(req, {
      message: longQuery,
      projectId: 'smart-campus-management-system-ba18e773',
      history: [],
    })

    assert.equal(fetchCalled, true)
    assert.equal(response.grounded, true)
    assert.equal(response.mode, 'repository')
    assert.ok(response.reply.includes('add(a, b)'))
    assert.ok(response.reply.includes('multiply(a, b)'))
    assert.ok(response.reply.includes('[S1]'))
    assert.equal(response.sources.length, 1)
    assert.equal(response.sources[0].path, 'DevNexus-Upload-Test/utils.js')
  })
})

test('generateRepositoryReply: missing symbol query returns UNVERIFIED without calling Gemini', async () => {
  const req = createMockReq()
  let fetchCalled = false

  await withMockFetch(async () => {
    fetchCalled = true
    throw new Error('Gemini API should NOT be called when no chunks are retrieved')
  }, async () => {
    const response = await generateRepositoryReply(req, {
      message: 'Explain nonExistentFunction(x, y)',
      projectId: 'smart-campus-management-system-ba18e773',
      history: [],
    })

    assert.equal(fetchCalled, false, 'Fetch must not be invoked')
    assert.equal(response.grounded, false)
    assert.equal(response.reply, UNVERIFIED)
    assert.deepEqual(response.sources, [])
  })
})
