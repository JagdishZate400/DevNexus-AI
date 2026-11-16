require('./helpers/offline')
const { test, describe, before } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const request = require('supertest')

const config = require('../src/config')
Object.assign(config, {
  aiProvider: 'gemini',
  geminiApiKey: 'test-key',
  geminiModel: 'test-model',
  geminiTimeoutMs: 1000,
})

const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const { generateRepositoryReply } = require('../src/services/repositoryChat')

async function mocked(handler, run) {
  const original = global.fetch
  global.fetch = handler
  try {
    await run()
  } finally {
    global.fetch = original
  }
}

function answer(value) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] },
        },
      ],
    })
  )
}

describe('Phase 5: Multi-Language End-to-End AI Integration', () => {
  let app, token, owner, storedProjects, storedFiles, storedChunks, storedIndexes
  const projectId = 'multi-lang-e2e-project'

  before(async () => {
    const users = createTestRepository()
    owner = { id: crypto.randomUUID(), email: 'multilang-owner@example.com', role: 'Developer' }
    await users.createUser(owner)
    token = signToken(owner)

    storedProjects = new Map([[projectId, { id: projectId, name: 'Polyglot Project', ownerId: owner.id }]])
    storedFiles = new Map()
    storedChunks = []
    storedIndexes = new Map()

    const filesData = [
      {
        path: 'server/app.py',
        language: 'Python',
        content: 'import os\n\ndef calculate_discount(price, rate):\n    """Calculates discount"""\n    return price * (1.0 - rate)\n\ndef start_app():\n    return True\n',
      },
      {
        path: 'client/src/App.jsx',
        language: 'JavaScript',
        content: 'import React from "react";\n\nexport function App() {\n  return <div>Polyglot UI</div>;\n}\n',
      },
      {
        path: 'services/worker.go',
        language: 'Go',
        content: 'package worker\n\nimport "fmt"\n\nfunc RunWorker() {\n    fmt.Println("Worker active")\n}\n',
      },
      {
        path: 'native/lib.rs',
        language: 'Rust',
        content: 'pub fn compute_hash(input: &str) -> u64 {\n    42\n}\n',
      },
      {
        path: 'db/migrations.sql',
        language: 'SQL',
        content: 'CREATE TABLE orders (\n    id UUID PRIMARY KEY,\n    amount NUMERIC(10, 2)\n);\n',
      },
      {
        path: 'core/Calculator.java',
        language: 'Java',
        content: 'package com.devnexus;\n\npublic class Calculator {\n    public int add(int a, int b) {\n        return a + b;\n    }\n}\n',
      },
    ]

    for (const f of filesData) {
      const fileId = crypto.randomUUID()
      const sha256 = crypto.createHash('sha256').update(f.content).digest('hex')
      const fileRecord = {
        id: fileId,
        projectId,
        path: f.path,
        language: f.language,
        content: f.content,
        byteSize: Buffer.byteLength(f.content, 'utf8'),
        sha256,
      }
      storedFiles.set(fileId, fileRecord)

      // Add a chunk for each file
      const chunkId = crypto.randomUUID()
      storedChunks.push({
        id: chunkId,
        fileId,
        path: f.path,
        language: f.language,
        startLine: 1,
        endLine: f.content.split('\n').length,
        startColumn: 1,
        endColumn: 1,
        snippet: f.content,
        search_vector: f.path + ' ' + f.content,
        rank: 0.9,
      })
      storedIndexes.set(fileId, { fileId, status: 'indexed', source_sha256: sha256, index_version: 1 })
    }

    const mockSourceRepo = {
      async listProjects(userId) { return [...storedProjects.values()].filter((p) => p.ownerId === userId) },
      async findProject(id, userId) {
        const p = storedProjects.get(id)
        return p && p.ownerId === userId ? p : null
      },
      async listFiles(id, userId) {
        if (!await this.findProject(id, userId)) return []
        return [...storedFiles.values()].filter((f) => f.projectId === id)
      },
      async readFile(id, fileId, userId) {
        if (!await this.findProject(id, userId)) return null
        return storedFiles.get(fileId) || null
      },
      async searchSource(projId, userId, query, limit) {
        const q = String(query).toLowerCase()
        return storedChunks.filter((c) => c.snippet.toLowerCase().includes(q) || c.path.toLowerCase().includes(q)).slice(0, limit)
      },
      async indexStats(projId, userId) {
        return { totalFiles: storedFiles.size, indexedFiles: storedFiles.size, pendingFiles: 0, chunkCount: storedChunks.length }
      },
      async discoverReviewFiles(id, userId) {
        const project = await this.findProject(id, userId)
        if (!project) return null
        const files = [...storedFiles.values()].map((f) => ({
          ...f,
          characterCount: f.content.length,
          lineCount: f.content.split('\n').length,
        }))
        return {
          totalFiles: files.length,
          totalBytes: files.reduce((s, f) => s + f.byteSize, 0),
          files,
        }
      },
    }

    const mockReviewRepo = {
      reviews: new Map(),
      async start(data, userId) {
        const id = crypto.randomUUID()
        const review = { id, userId, ...data, status: 'Running', findings: [] }
        this.reviews.set(id, review)
        return id
      },
      async complete(id, userId, findings) {
        const review = this.reviews.get(id)
        if (!review) return null
        review.status = 'Completed'
        review.findings = findings
        return review
      },
      async read(id, userId) {
        return this.reviews.get(id) || null
      },
      async fail(id, userId, code) {
        const review = this.reviews.get(id)
        if (review) { review.status = 'Failed'; review.errorCode = code }
      },
    }

    const mockDocRepo = {
      docs: new Map(),
      async prepareGeneration(data, userId) {
        const id = crypto.randomUUID()
        const doc = {
          id,
          userId,
          ...data,
          generationStatus: 'Pending',
          sourceReferences: data.fileIds.map((fileId) => {
            const f = storedFiles.get(fileId)
            return { fileId, path: f.path, hash: f.sha256 }
          }),
        }
        this.docs.set(id, doc)
        return doc
      },
      async startGeneration(id, userId) {
        const doc = this.docs.get(id)
        if (doc) doc.generationStatus = 'Running'
      },
      async completeGeneration(id, userId, markdown, coverage, citations) {
        const doc = this.docs.get(id)
        if (!doc) return null
        doc.generationStatus = 'Completed'
        doc.markdown = markdown
        doc.coverage = coverage
        doc.citations = citations
        return doc
      },
      async failGeneration(id, userId, code) {
        const doc = this.docs.get(id)
        if (doc) { doc.generationStatus = 'Failed'; doc.errorCode = code }
        return doc
      },
      async replayGeneration() { return null },
    }

    app = createApp({
      userRepository: users,
      sourceRepository: mockSourceRepo,
      reviewRepository: mockReviewRepo,
      documentRepository: mockDocRepo,
    })
  })

  // -------------------------------------------------------------
  // Test 1: Python + React Multi-Language AI Chat Retrieval
  // -------------------------------------------------------------
  test('1. AI Chat successfully grounds and cites Python function calculate_discount', async () => {
    await mocked(
      async (url, options) => {
        const body = JSON.parse(options.body)
        const lastUser = JSON.parse(body.contents.at(-1).parts[0].text)
        assert.ok(lastUser.question.includes('calculate_discount'))
        assert.ok(lastUser.untrustedSourceChunks.length > 0)

        const pyChunk = lastUser.untrustedSourceChunks.find((c) => c.path === 'server/app.py')
        assert.ok(pyChunk, 'Python chunk must be present in retrieved context')
        assert.equal(pyChunk.language, 'Python')

        return answer({
          answer: `In \`server/app.py\`, the \`calculate_discount\` function [${pyChunk.citationId}] calculates the discounted price.\n\n### Python Implementation\n\n\`\`\`python\ncalculate_discount(price, rate)\n\`\`\`\n\nIt takes price and discount rate, returning price * (1.0 - rate).`,
          verified: true,
          citationIds: [pyChunk.citationId],
        })
      },
      async () => {
        const mockReq = {
          app,
          user: { sub: owner.id, email: owner.email },
          params: { id: projectId },
        }

        const res = await generateRepositoryReply(mockReq, {
          message: 'How does calculate_discount work in server/app.py?',
          projectId,
        })

        assert.equal(res.grounded, true)
        assert.equal(res.sources.length, 1)
        assert.equal(res.sources[0].path, 'server/app.py')
        assert.equal(res.sources[0].language, 'Python')
        assert.ok(res.reply.includes('calculate_discount'))
        assert.ok(res.reply.includes('```python'))
        assert.ok(res.reply.includes('[S1]'))
      }
    )
  })

  // -------------------------------------------------------------
  // Test 2: Java, Go, Rust, and SQL Code Review Support
  // -------------------------------------------------------------
  test('2. Single-file Code Review succeeds for Go, Rust, Java, and SQL files without language rejection', async () => {
    await mocked(
      async (url, options) => {
        const body = JSON.parse(options.body)
        const userContent = JSON.parse(body.contents[0].parts[0].text)
        assert.ok(userContent.language)

        return answer({
          findings: [
            {
              findingType: 'Bug',
              severity: 'Medium',
              line: 1,
              category: 'Logic',
              problem: `Potential issue in ${userContent.language} code`,
              explanation: `Observed in ${userContent.file}`,
              improvement: 'Add boundary checks',
              suggestedCode: '// Fixed code',
            },
          ],
        })
      },
      async () => {
        const nonJsFiles = [
          { path: 'services/worker.go', lang: 'go' },
          { path: 'native/lib.rs', lang: 'rust' },
          { path: 'core/Calculator.java', lang: 'java' },
          { path: 'db/migrations.sql', lang: 'sql' },
        ]

        for (const item of nonJsFiles) {
          const fileRecord = [...storedFiles.values()].find((f) => f.path === item.path)
          assert.ok(fileRecord, `File ${item.path} must exist in store`)

          const res = await request(app)
            .post('/api/repository-reviews')
            .set('Authorization', `Bearer ${token}`)
            .send({
              projectId,
              fileId: fileRecord.id,
              options: { focus: 'General' },
            })

          assert.equal(res.status, 201, `Review for ${item.path} (${item.lang}) must return 201 Created`)
          assert.ok(res.body.review)
          assert.equal(res.body.review.findings.length, 1)
          assert.equal(res.body.review.findings[0].category, 'Logic')
        }
      }
    )
  })

  // -------------------------------------------------------------
  // Test 3: Documentation Generation for Mixed-Language Project
  // -------------------------------------------------------------
  test('3. Documentation generation succeeds on mixed-language snapshot citing Python and React', async () => {
    await mocked(
      async (url, options) => {
        const body = JSON.parse(options.body)
        const contextObj = JSON.parse(body.contents[0].parts[0].text)
        assert.ok(contextObj.files.length >= 2)
        const pyFile = contextObj.files.find((f) => f.path === 'server/app.py')
        const jsFile = contextObj.files.find((f) => f.path === 'client/src/App.jsx')
        assert.ok(pyFile)
        assert.ok(jsFile)

        return answer({
          claims: [
            {
              section: 'Purpose',
              text: 'The project provides discount calculations and a React web interface.',
              citations: [
                {
                  fileId: pyFile.fileId,
                  path: 'server/app.py',
                  lineStart: 3,
                  lineEnd: 5,
                  quote: 'def calculate_discount(price, rate):\n    """Calculates discount"""\n    return price * (1.0 - rate)',
                },
              ],
            },
            {
              section: 'Key functions and components',
              text: 'App renders the main polyglot user interface component.',
              citations: [
                {
                  fileId: jsFile.fileId,
                  path: 'client/src/App.jsx',
                  lineStart: 3,
                  lineEnd: 5,
                  quote: 'export function App() {\n  return <div>Polyglot UI</div>;\n}',
                },
              ],
            },
          ],
        })
      },
      async () => {
        const res = await request(app)
          .post('/api/project-documents/generate')
          .set('Authorization', `Bearer ${token}`)
          .send({
            projectId,
            documentType: 'project-overview',
          })

        assert.equal(res.status, 201)
        assert.ok(res.body.document)
        assert.equal(res.body.document.documentType, 'project-overview')
        assert.ok(res.body.document.markdown.includes('# Project Overview'))
        assert.ok(res.body.document.markdown.includes('server/app'))
        assert.ok(res.body.document.markdown.includes('client/src/App'))
        assert.ok(res.body.document.markdown.includes('Only uploaded source was supplied.'))
      }
    )
  })

  // -------------------------------------------------------------
  // Test 4: Incomplete and Failed Indexing Scenarios in AI Chat
  // -------------------------------------------------------------
  test('4. AI Chat communicates partial status when indexing is in progress', async () => {
    await mocked(
      async () => {
        return answer({
          answer: 'The discount function is defined in app.py [S1].',
          verified: true,
          citationIds: ['S1'],
        })
      },
      async () => {
        const mockReq = {
          app: {
            locals: {
              sourceRepository: {
                findProject: async () => ({ id: projectId, owner_id: owner.id }),
                searchSource: async () => [
                  {
                    id: 'chunk-1',
                    fileId: 'file-1',
                    path: 'server/app.py',
                    language: 'Python',
                    startLine: 1,
                    endLine: 4,
                    startColumn: 1,
                    endColumn: 1,
                    snippet: 'def calculate_discount(): pass\n',
                  },
                ],
                indexStats: async () => ({
                  totalFiles: 20,
                  indexedFiles: 10,
                  pendingFiles: 10,
                  chunkCount: 10,
                }),
              },
            },
          },
          user: { sub: owner.id, email: owner.email },
          params: { id: projectId },
        }

        const res = await generateRepositoryReply(mockReq, {
          message: 'Explain discount function',
          projectId,
        })

        assert.equal(res.grounded, true)
        assert.equal(res.indexingInProgress, true)
        assert.ok(res.notice.includes('Project source code is currently being indexed'))
        assert.ok(res.notice.includes('Results may be partial'))
      }
    )
  })
})
