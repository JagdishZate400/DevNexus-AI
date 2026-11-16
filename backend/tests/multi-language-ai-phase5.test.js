require('./helpers/offline')
const { test, describe, before } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

const { validateReviewSource } = require('../src/services/reviewSource')
const { buildDiscoveryPreview } = require('../src/services/reviewDiscovery')
const { analyzeSource } = require('../src/services/documentSourceAnalysis')
const { extractEvidence, evidencePath } = require('../src/services/documentEvidence')
const { buildCatalog } = require('../src/services/documentCatalog')
const { retrieve, generateRepositoryReply, extractSearchTerms } = require('../src/services/repositoryChat')

describe('Phase 5: Multi-Language AI Integration', () => {

  // -------------------------------------------------------------
  // Test Suite 1: Code Review Source Validation & Discovery
  // -------------------------------------------------------------
  describe('Code Review Multi-Language Enablement', () => {
    const codeLanguages = [
      { lang: 'Python', path: 'src/analytics.py', content: 'def calculate_metric(data):\n    return sum(data)\n' },
      { lang: 'Java', path: 'src/Calculator.java', content: 'public class Calculator {\n    public int add(int a, int b) { return a + b; }\n}\n' },
      { lang: 'Go', path: 'pkg/worker.go', content: 'package worker\n\nfunc Process() error {\n    return nil\n}\n' },
      { lang: 'Rust', path: 'src/lib.rs', content: 'pub fn multiply(a: i32, b: i32) -> i32 {\n    a * b\n}\n' },
      { lang: 'C', path: 'src/main.c', content: '#include <stdio.h>\nint main() { return 0; }\n' },
      { lang: 'C++', path: 'src/engine.cpp', content: '#include <iostream>\nclass Engine { public: void run() {} };\n' },
      { lang: 'C#', path: 'src/App.cs', content: 'using System;\nclass App { static void Main() {} }\n' },
      { lang: 'PHP', path: 'src/index.php', content: '<?php\nfunction handle() { echo "ok"; }\n' },
      { lang: 'SQL', path: 'db/schema.sql', content: 'CREATE TABLE users (id UUID PRIMARY KEY, email VARCHAR(255));\n' },
      { lang: 'JavaScript', path: 'src/index.js', content: 'export function start() { return true; }\n' },
      { lang: 'TypeScript', path: 'src/types.ts', content: 'export interface User { id: string; }\n' },
    ]

    const nonCodeLanguages = [
      { lang: 'HTML', path: 'public/index.html', content: '<!DOCTYPE html><html><body><h1>DevNexus</h1></body></html>\n' },
      { lang: 'CSS', path: 'styles/main.css', content: 'body { margin: 0; padding: 0; }\n' },
      { lang: 'JSON', path: 'config/rules.json', content: '{\n  "version": "1.0.0"\n}\n' },
      { lang: 'YAML', path: 'config/deploy.yaml', content: 'service: devnexus\nreplicas: 3\n' },
    ]

    test('1. validateReviewSource accepts all supported code languages without throwing unsupported_file', () => {
      for (const item of codeLanguages) {
        const file = {
          id: crypto.randomUUID(),
          path: item.path,
          language: item.lang,
          content: item.content,
          sha256: crypto.createHash('sha256').update(item.content).digest('hex'),
        }

        const coverage = validateReviewSource(file)
        assert.equal(coverage.path, item.path)
        assert.equal(coverage.sourceHash, file.sha256)
        assert.equal(coverage.truncated, false)
      }
    })

    test('2. validateReviewSource safely classifies non-code files and unsupported extensions as unsupported_file', () => {
      const unsupported = [
        ...nonCodeLanguages,
        { lang: 'UnknownLang', path: 'file.xyz', content: 'test content' },
        { lang: 'Python', path: 'script.unknown', content: 'test content' },
      ]

      for (const item of unsupported) {
        const file = {
          id: crypto.randomUUID(),
          path: item.path,
          language: item.lang,
          content: item.content,
          sha256: crypto.createHash('sha256').update(item.content).digest('hex'),
        }
        assert.throws(() => validateReviewSource(file), { code: 'unsupported_file' })
      }
    })

    test('3. buildDiscoveryPreview classifies code languages as Eligible and non-code files as Known Exclusions', () => {
      const allFiles = [...codeLanguages, ...nonCodeLanguages].map(item => {
        const lines = item.content.split('\n')
        return {
          id: crypto.randomUUID(),
          path: item.path,
          language: item.lang,
          byteSize: Buffer.byteLength(item.content, 'utf8'),
          characterCount: item.content.length,
          lineCount: lines.length,
          sha256: crypto.createHash('sha256').update(item.content).digest('hex'),
        }
      })

      const snapshot = {
        totalFiles: allFiles.length,
        totalBytes: allFiles.reduce((s, f) => s + f.byteSize, 0),
        files: allFiles,
      }

      const preview = buildDiscoveryPreview(snapshot, 'test-multi-lang-project')
      assert.equal(preview.totalDiscoveredFiles, 15)
      assert.equal(preview.eligibleCandidateCount, 11)
      assert.equal(preview.knownSkippedFileCount, 4)
      assert.equal(preview.skipReasons.length, 1)
      assert.equal(preview.skipReasons[0].code, 'unsupported_file')
      assert.equal(preview.skipReasons[0].count, 4)

      for (const fileEntry of preview.files) {
        const isNonCode = nonCodeLanguages.some(n => n.path === fileEntry.path)
        if (isNonCode) {
          assert.equal(fileEntry.eligibility, 'Known Exclusion')
          assert.equal(fileEntry.skipReason.code, 'unsupported_file')
        } else {
          assert.equal(fileEntry.eligibility, 'Eligible Candidate')
          assert.equal(fileEntry.skipReason, null)
        }
      }
    })
  })

  // -------------------------------------------------------------
  // Test Suite 2: Documentation Generation & Babel Safeguards
  // -------------------------------------------------------------
  describe('Documentation Generation & Evidence Extraction', () => {
    test('4. evidencePath accepts all 15 supported source language files as source', () => {
      assert.equal(evidencePath('src/main.py'), 'source')
      assert.equal(evidencePath('src/Main.java'), 'source')
      assert.equal(evidencePath('src/server.go'), 'source')
      assert.equal(evidencePath('src/lib.rs'), 'source')
      assert.equal(evidencePath('db/init.sql'), 'source')
      assert.equal(evidencePath('src/app.jsx'), 'source')
      assert.equal(evidencePath('src/types.ts'), 'source')
      assert.equal(evidencePath('src/util.c'), 'source')
      assert.equal(evidencePath('src/engine.cpp'), 'source')
      assert.equal(evidencePath('src/Program.cs'), 'source')
      assert.equal(evidencePath('src/index.php'), 'source')
      assert.equal(evidencePath('public/index.html'), 'source')
      assert.equal(evidencePath('styles/main.css'), 'source')
      assert.equal(evidencePath('config/data.json'), 'source')
      assert.equal(evidencePath('config/settings.yaml'), 'source')

      // Preserves special files
      assert.equal(evidencePath('package.json'), 'manifest')
      assert.equal(evidencePath('package-lock.json'), 'lockfile')
      assert.equal(evidencePath('README.md'), 'setup')
      assert.equal(evidencePath('.env.example'), 'configuration-example')
    })

    test('5. analyzeSource uses Babel for JS/TS and safe pattern extractor for non-JS/TS without failing', () => {
      // JavaScript/TypeScript (Babel)
      const jsFile = {
        id: crypto.randomUUID(),
        path: 'src/index.js',
        sha256: 'a1',
        content: 'import express from "express";\nexport function handler(req, res) { return res.json({ ok: true }); }\n',
      }
      const jsFacts = analyzeSource(jsFile)
      assert.equal(jsFacts.parser, '@babel/parser')
      assert.equal(jsFacts.imports.length, 1)
      assert.equal(jsFacts.exports.length, 1)
      assert.equal(jsFacts.symbols.length, 1)

      // Python (Pattern Extractor - Babel must NOT be called)
      const pyFile = {
        id: crypto.randomUUID(),
        path: 'src/main.py',
        sha256: 'b2',
        content: 'import os\nfrom fastapi import FastAPI\n\napp = FastAPI()\n\ndef get_user(user_id: str):\n    """Retrieves user"""\n    return {"id": user_id}\n\nclass UserStore:\n    pass\n\nport = os.environ.get("APP_PORT")\n',
      }
      const pyFacts = analyzeSource(pyFile)
      assert.equal(pyFacts.parser, 'multi-language-text-fallback')
      assert.ok(pyFacts.imports.some(i => i.specifier === 'fastapi'))
      assert.ok(pyFacts.symbols.some(s => s.name === 'get_user' && s.kind === 'function'))
      assert.ok(pyFacts.symbols.some(s => s.name === 'UserStore' && s.kind === 'class'))
      assert.ok(pyFacts.environment.some(e => e.name === 'APP_PORT'))

      // Go (Pattern Extractor)
      const goFile = {
        id: crypto.randomUUID(),
        path: 'pkg/server.go',
        sha256: 'c3',
        content: 'package main\n\nimport "net/http"\n\nfunc StartServer() {\n    println("running")\n}\n\ntype Config struct {\n    Port int\n}\n',
      }
      const goFacts = analyzeSource(goFile)
      assert.equal(goFacts.parser, 'multi-language-text-fallback')
      assert.ok(goFacts.imports.some(i => i.specifier === 'net/http'))
      assert.ok(goFacts.symbols.some(s => s.name === 'StartServer'))
      assert.ok(goFacts.exports.some(e => e.name === 'StartServer'))

      // Rust (Pattern Extractor)
      const rustFile = {
        id: crypto.randomUUID(),
        path: 'src/crypto.rs',
        sha256: 'd4',
        content: 'use std::collections::HashMap;\n\npub fn hash_key(key: &str) -> String {\n    key.to_string()\n}\n\npub struct Hasher {\n    seed: u64,\n}\n',
      }
      const rustFacts = analyzeSource(rustFile)
      assert.equal(rustFacts.parser, 'multi-language-text-fallback')
      assert.ok(rustFacts.imports.some(i => i.specifier.includes('HashMap')))
      assert.ok(rustFacts.symbols.some(s => s.name === 'hash_key'))
      assert.ok(rustFacts.exports.some(e => e.name === 'hash_key'))

      // SQL (Pattern Extractor)
      const sqlFile = {
        id: crypto.randomUUID(),
        path: 'db/tables.sql',
        sha256: 'e5',
        content: 'CREATE TABLE accounts (id UUID PRIMARY KEY);\nCREATE VIEW active_accounts AS SELECT * FROM accounts;\n',
      }
      const sqlFacts = analyzeSource(sqlFile)
      assert.equal(sqlFacts.parser, 'multi-language-text-fallback')
      assert.ok(sqlFacts.symbols.some(s => s.name === 'accounts'))
      assert.ok(sqlFacts.symbols.some(s => s.name === 'active_accounts'))
    })

    test('6. extractEvidence extracts evidence from mixed-language project without crashing', () => {
      const mixedFiles = [
        {
          id: 'file-py',
          path: 'api/service.py',
          content: 'def run(): return 42\n',
        },
        {
          id: 'file-js',
          path: 'frontend/src/index.js',
          content: 'export const App = () => "Hello";\n',
        },
        {
          id: 'file-sql',
          path: 'db/schema.sql',
          content: 'CREATE TABLE metrics (val INT);\n',
        },
        {
          id: 'file-readme',
          path: 'README.md',
          content: '# Mixed Project\n```sh\n$ npm install\n```\n',
        },
        {
          id: 'file-pkg',
          path: 'package.json',
          content: '{\n  "name": "mixed-project",\n  "version": "1.0.0"\n}\n',
        }
      ].map(f => ({
        ...f,
        sha256: crypto.createHash('sha256').update(f.content).digest('hex')
      }))

      const evidence = extractEvidence(mixedFiles)
      assert.equal(evidence.files.length, 5)
      assert.ok(evidence.structure.files.includes('api/service.py'))
      assert.ok(evidence.structure.files.includes('frontend/src/index.js'))
      assert.ok(evidence.structure.files.includes('db/schema.sql'))

      // Verify buildCatalog succeeds with multi-language facts
      const catalog = buildCatalog(
        { files: mixedFiles },
        {
          required: [['paths']],
          sections: { artifact: 'Main components', symbol: 'Key functions', import: 'Dependencies' }
        }
      )
      assert.ok(catalog.facts.length > 0)
      assert.ok(catalog.facts.some(f => f.text.includes('api/service.py')))
      assert.ok(catalog.facts.some(f => f.text.includes('db/schema.sql')))
    })
  })

  // -------------------------------------------------------------
  // Test Suite 3: AI Chat Grounding, Citations & Incomplete Indexing
  // -------------------------------------------------------------
  describe('AI Chat Multi-Language Retrieval & Grounding', () => {
    test('7. extractSearchTerms extracts identifiers from Python, Go, Rust, and SQL queries', () => {
      const pyQuery = 'Explain def compute_kpi(metric_list) in analytics.py'
      const termsPy = extractSearchTerms(pyQuery)
      assert.ok(termsPy.includes('compute_kpi'))
      assert.ok(termsPy.includes('analytics'))

      const goQuery = 'How does func StartServer() in server.go work?'
      const termsGo = extractSearchTerms(goQuery)
      assert.ok(termsGo.includes('StartServer'))
      assert.ok(termsGo.includes('server'))

      const sqlQuery = 'What columns are in `orders` schema.sql?'
      const termsSql = extractSearchTerms(sqlQuery)
      assert.ok(termsSql.includes('orders'))
      assert.ok(termsSql.includes('schema'))
    })

    test('8. retrieve passes language metadata in citations for non-JS/TS chunks', async () => {
      const mockReq = {
        app: { locals: {} },
        user: { sub: 'user-123', email: 'owner@example.com' },
        params: { id: 'multi-lang-proj' }
      }

      // Mock searchSource to return multi-language chunks with language attribute
      const mockSources = {
        findProject: async () => ({ id: 'multi-lang-proj', owner_id: 'user-123' }),
        searchSource: async (projId, userId, query) => {
          if (query.toLowerCase().includes('compute_kpi')) {
            return [{
              id: 'chunk-py-1',
              fileId: 'file-py-1',
              path: 'src/analytics.py',
              language: 'Python',
              startLine: 1,
              endLine: 4,
              startColumn: 1,
              endColumn: 25,
              snippet: 'def compute_kpi(metric_list):\n    return sum(metric_list) / len(metric_list)\n',
              rank: 0.95
            }]
          }
          if (query.toLowerCase().includes('hash_key')) {
            return [{
              id: 'chunk-rs-1',
              fileId: 'file-rs-1',
              path: 'src/crypto.rs',
              language: 'Rust',
              startLine: 5,
              endLine: 8,
              startColumn: 1,
              endColumn: 18,
              snippet: 'pub fn hash_key(key: &str) -> String {\n    key.to_string()\n}\n',
              rank: 0.90
            }]
          }
          return []
        }
      }

      // Override sourceQuery behavior for test
      mockReq.app.locals.sourceRepository = mockSources

      const chunks = await retrieve(mockReq, 'multi-lang-proj', 'How does compute_kpi in analytics.py and hash_key work?')
      assert.ok(chunks.length >= 2)

      const pyChunk = chunks.find(c => c.path === 'src/analytics.py')
      assert.ok(pyChunk)
      assert.equal(pyChunk.language, 'Python')
      assert.equal(pyChunk.citationId, 'S1')
      assert.equal(pyChunk.startLine, 1)
      assert.equal(pyChunk.endLine, 4)

      const rsChunk = chunks.find(c => c.path === 'src/crypto.rs')
      assert.ok(rsChunk)
      assert.equal(rsChunk.language, 'Rust')
      assert.equal(rsChunk.startLine, 5)
    })

    test('9. generateRepositoryReply guards against incomplete indexing when no chunks are found', async () => {
      const mockReq = {
        app: { locals: {} },
        user: { sub: 'user-123', email: 'owner@example.com' },
        params: { id: 'pending-index-proj' }
      }

      const mockSources = {
        findProject: async () => ({ id: 'pending-index-proj', owner_id: 'user-123' }),
        searchSource: async () => [], // No chunks found because indexing hasn't completed
        indexStats: async () => ({
          indexedFiles: 10,
          totalFiles: 100,
          pendingFiles: 90,
          chunkCount: 10
        })
      }
      mockReq.app.locals.sourceRepository = mockSources

      const result = await generateRepositoryReply(mockReq, {
        message: 'What is in the codebase?',
        projectId: 'pending-index-proj'
      })

      assert.equal(result.grounded, false)
      assert.equal(result.indexingInProgress, true)
      assert.ok(result.reply.includes('currently being indexed'))
      assert.ok(result.reply.includes('10 of 100 files completed, 90 pending'))
      assert.equal(result.sources.length, 0)
    })
  })
})
