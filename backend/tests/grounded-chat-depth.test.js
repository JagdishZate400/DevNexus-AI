require('./helpers/offline')
const { test } = require('node:test')
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
  generateRepositoryReply,
  GROUNDED_CHAT_SYSTEM_PROMPT,
  UNVERIFIED,
} = require('../src/services/repositoryChat')
const gemini = require('../src/services/gemini')

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

const mockChunk1 = {
  id: '101',
  citationId: 'S1',
  chunkId: '101',
  fileId: crypto.randomUUID(),
  projectId: 'proj-grounded-depth',
  path: 'src/math/utils.js',
  startLine: 1,
  endLine: 8,
  startColumn: 1,
  endColumn: 1,
  snippet: 'export function add(a, b) {\n  return a + b;\n}\n\nexport function multiply(a, b) {\n  return a * b;\n}\n',
}

const mockChunk2 = {
  id: '102',
  citationId: 'S2',
  chunkId: '102',
  fileId: crypto.randomUUID(),
  projectId: 'proj-grounded-depth',
  path: 'src/app.js',
  startLine: 1,
  endLine: 10,
  startColumn: 1,
  endColumn: 1,
  snippet: "import { add, multiply } from './math/utils';\n\nexport function calculate(x, y) {\n  return add(x, multiply(x, y));\n}\n",
}

function createFakeReq(chunks = [mockChunk1]) {
  return {
    app: {
      locals: {
        sourceRepository: {
          async findProject(id) {
            return id === 'proj-grounded-depth' ? { id, name: 'Depth Project' } : null
          },
          async searchSource(id, uid, term) {
            return chunks
          },
        },
      },
    },
    user: { sub: 'usr-depth-1', email: 'developer@example.com' },
  }
}

test('1. System prompt includes all depth, structure, quality, and security requirements', () => {
  // Security & evidence rules
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /UNTRUSTED DATA/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Only the supplied source chunks are evidence/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /"answer": "...", "verified": true\|false, "citationIds":/)

  // Function explanation guidelines
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Function & API Explanations:/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Purpose:/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Parameters & Returns:/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Working & Logic:/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Example & Expected Output:/)

  // Architecture & Project overview guidelines
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Architecture & Project Overview:/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /component responsibilities, data flow, key interactions/)

  // Code review guidelines
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Code Review & Quality:/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /actionable improvements visible in the source chunks without inventing defects/)

  // Adaptive depth guidelines
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Explicit Brevity\/Detail:/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Partial Context:/)

  // Markdown heading and whitespace separation guidelines
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /Markdown Headings & Section Separation:/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /dedicated, separate line/)
  assert.match(GROUNDED_CHAT_SYSTEM_PROMPT, /blank lines/)
})

test('2. Function explanation produces comprehensive, structured response with valid citations', async () => {
  const req = createFakeReq([mockChunk1])
  let capturedBody

  await withMockFetch(async (url, opts) => {
    capturedBody = JSON.parse(opts.body)
    return answerPayload({
      answer:
        '### Purpose\nThe `add` and `multiply` functions in `src/math/utils.js` perform basic arithmetic addition and multiplication [S1].\n\n' +
        '### Parameters & Returns\n- `add(a, b)`: Accepts two numeric parameters `a` and `b`, returning their sum `a + b` [S1].\n' +
        '- `multiply(a, b)`: Accepts two numeric parameters `a` and `b`, returning their product `a * b` [S1].\n\n' +
        '### Working & Logic\nBoth functions use direct JavaScript arithmetic operators (`+` and `*`) to evaluate the expression and return the scalar result [S1].\n\n' +
        '### Example & Output\n- `add(10, 5)` evaluates to `15` [S1].\n- `multiply(10, 5)` evaluates to `50` [S1].',
      verified: true,
      citationIds: ['S1'],
    })
  }, async () => {
    const res = await generateRepositoryReply(req, {
      message: 'Explain how add(a, b) and multiply(a, b) work in utils.js with examples.',
      projectId: 'proj-grounded-depth',
      history: [],
    })

    assert.equal(res.grounded, true)
    assert.equal(res.mode, 'repository')
    assert.equal(res.provider, 'gemini')
    assert.ok(res.reply.includes('### Purpose'))
    assert.ok(res.reply.includes('### Parameters & Returns'))
    assert.ok(res.reply.includes('### Working & Logic'))
    assert.ok(res.reply.includes('### Example & Output'))
    assert.ok(res.reply.includes('[S1]'))
    assert.equal(res.sources.length, 1)
    assert.equal(res.sources[0].path, 'src/math/utils.js')

    // Verify token limit passed to Gemini
    assert.equal(capturedBody.generationConfig.maxOutputTokens, 4096)
  })
})

test('3. Architecture question synthesizes multiple retrieved chunks into a structured breakdown', async () => {
  const req = createFakeReq([mockChunk1, mockChunk2])

  await withMockFetch(async (_, opts) => {
    return answerPayload({
      answer:
        '### Architecture Overview\nThe project demonstrates a modular architecture with mathematical operations encapsulated in `src/math/utils.js` [S1] and composed in `src/app.js` [S2].\n\n' +
        '### Component Responsibilities\n- **Math Utilities (`src/math/utils.js`)**: Exports `add` and `multiply` [S1].\n' +
        '- **Application Orchestrator (`src/app.js`)**: Imports `add` and `multiply` to compute higher-level expressions via `calculate(x, y)` [S2].\n\n' +
        '### Data Flow\nThe `calculate` function passes `x` and `y` to `multiply(x, y)` first, and feeds the product along with `x` into `add` [S2].',
      verified: true,
      citationIds: ['S1', 'S2'],
    })
  }, async () => {
    const res = await generateRepositoryReply(req, {
      message: 'Describe the architecture and data flow between utils.js and app.js.',
      projectId: 'proj-grounded-depth',
      history: [],
    })

    assert.equal(res.grounded, true)
    assert.equal(res.sources.length, 2)
    assert.deepEqual(
      res.sources.map((s) => s.path),
      ['src/math/utils.js', 'src/app.js']
    )
    assert.ok(res.reply.includes('Architecture Overview'))
    assert.ok(res.reply.includes('[S1]'))
    assert.ok(res.reply.includes('[S2]'))
  })
})

test('4. Code review question returns concrete grounded observations without inventing defects', async () => {
  const req = createFakeReq([mockChunk1])

  await withMockFetch(async () => {
    return answerPayload({
      answer:
        '### Code Quality Review for `src/math/utils.js`\n' +
        '- **Type Validation**: The `add(a, b)` and `multiply(a, b)` functions do not validate that arguments are numbers, meaning string arguments would trigger concatenation in `add` instead of arithmetic addition [S1].\n' +
        '- **Improvement**: If runtime type safety is required, add input type checks or convert arguments via `Number(a)` before performing arithmetic operations [S1].',
      verified: true,
      citationIds: ['S1'],
    })
  }, async () => {
    const res = await generateRepositoryReply(req, {
      message: 'Review utils.js for edge cases and potential improvements.',
      projectId: 'proj-grounded-depth',
      history: [],
    })

    assert.equal(res.grounded, true)
    assert.ok(res.reply.includes('Type Validation'))
    assert.ok(res.reply.includes('[S1]'))
  })
})

test('5. Explicit request for brevity returns concise grounded answer', async () => {
  const req = createFakeReq([mockChunk1])

  await withMockFetch(async () => {
    return answerPayload({
      answer: 'The `add` function returns the mathematical sum of parameters `a` and `b` [S1].',
      verified: true,
      citationIds: ['S1'],
    })
  }, async () => {
    const res = await generateRepositoryReply(req, {
      message: 'In one sentence, what does add(a, b) do?',
      projectId: 'proj-grounded-depth',
      history: [],
    })

    assert.equal(res.grounded, true)
    assert.equal(res.reply, 'The `add` function returns the mathematical sum of parameters `a` and `b` [S1].')
    assert.equal(res.sources.length, 1)
  })
})

test('6. Partial context answers supported claim and clearly notes limitation for missing files', async () => {
  const req = createFakeReq([mockChunk1])

  await withMockFetch(async () => {
    return answerPayload({
      answer:
        '`add` is implemented as `return a + b;` in `src/math/utils.js` [S1]. ' +
        'However, the database storage layer mentioned in your query is not present in the provided source chunks, so that portion cannot be verified.',
      verified: true,
      citationIds: ['S1'],
    })
  }, async () => {
    const res = await generateRepositoryReply(req, {
      message: 'How does add work and how does it save results to the database?',
      projectId: 'proj-grounded-depth',
      history: [],
    })

    assert.equal(res.grounded, true)
    assert.ok(res.reply.includes('not present in the provided source chunks'))
    assert.ok(res.reply.includes('[S1]'))
  })
})

test('7. Completely unverified source context returns standard refusal', async () => {
  const req = createFakeReq([mockChunk1])

  await withMockFetch(async () => {
    return answerPayload({
      answer: 'I cannot verify this information from the provided chunks.',
      verified: false,
      citationIds: [],
    })
  }, async () => {
    const res = await generateRepositoryReply(req, {
      message: 'Explain the payment processing gateway in this project.',
      projectId: 'proj-grounded-depth',
      history: [],
    })

    assert.equal(res.grounded, false)
    assert.equal(res.reply, UNVERIFIED)
    assert.deepEqual(res.sources, [])
  })
})

test('8. Hallucinated or invalid citations fail closed with ai_invalid_citations', async () => {
  const req = createFakeReq([mockChunk1])

  // Test 8A: Invented citation ID
  await withMockFetch(async () => {
    return answerPayload({
      answer: 'add performs addition [S99].',
      verified: true,
      citationIds: ['S99'],
    })
  }, async () => {
    await assert.rejects(
      generateRepositoryReply(req, { message: 'explain add', projectId: 'proj-grounded-depth' }),
      (err) => err.code === 'ai_invalid_citations'
    )
  })

  // Test 8B: Inline citation tag not listed in citationIds
  await withMockFetch(async () => {
    return answerPayload({
      answer: 'add performs addition [S1] and [S2].',
      verified: true,
      citationIds: ['S1'],
    })
  }, async () => {
    await assert.rejects(
      generateRepositoryReply(req, { message: 'explain add', projectId: 'proj-grounded-depth' }),
      (err) => err.code === 'ai_invalid_citations'
    )
  })

  // Test 8C: Verified is true but citationIds is empty
  await withMockFetch(async () => {
    return answerPayload({
      answer: 'add performs addition.',
      verified: true,
      citationIds: [],
    })
  }, async () => {
    await assert.rejects(
      generateRepositoryReply(req, { message: 'explain add', projectId: 'proj-grounded-depth' }),
      (err) => err.code === 'ai_invalid_citations'
    )
  })
})

test('9. Token limit defaults to 4096 when responseSchema is supplied in gemini.generateContent', async () => {
  let capturedConfig

  await withMockFetch(async (url, opts) => {
    const body = JSON.parse(opts.body)
    capturedConfig = body.generationConfig
    return answerPayload({ answer: 'ok', verified: true, citationIds: ['S1'] })
  }, async () => {
    await gemini.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      responseSchema: { type: 'OBJECT', properties: { answer: { type: 'STRING' } } },
    })

    assert.equal(capturedConfig.maxOutputTokens, 4096)
    assert.equal(capturedConfig.responseMimeType, 'application/json')
  })
})
