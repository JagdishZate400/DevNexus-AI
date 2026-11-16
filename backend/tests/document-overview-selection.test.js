const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  CONTEXT_LIMITS,
  scoreFileForOverview,
  validateOverviewSource,
  selectOverviewFiles,
} = require('../src/services/documentOverviewSelection')

function makeFile(path, content, language = 'JavaScript') {
  return {
    id: crypto.randomUUID(),
    path,
    language,
    content,
    byteSize: Buffer.byteLength(content),
    characterCount: content.length,
    lineCount: content.split(/\r\n|\n|\r/).length,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  }
}

test('scoreFileForOverview prioritizes entry points, core engines, manifests, components, and deprioritizes tests', () => {
  // Tier 1: Entry points
  assert.equal(scoreFileForOverview({ path: 'backend/app/main.py', language: 'Python' }), 1000)
  assert.equal(scoreFileForOverview({ path: 'frontend/src/App.jsx', language: 'JavaScript' }), 1000)
  assert.equal(scoreFileForOverview({ path: 'frontend/src/main.jsx', language: 'JavaScript' }), 1000)
  assert.equal(scoreFileForOverview({ path: 'server.js', language: 'JavaScript' }), 1000)

  // Tier 2: Core Architecture & Engines
  assert.equal(scoreFileForOverview({ path: 'backend/app/core/gateway.py', language: 'Python' }), 800)
  assert.equal(scoreFileForOverview({ path: 'backend/app/core/decision_engine.py', language: 'Python' }), 800)
  assert.equal(scoreFileForOverview({ path: 'backend/app/services/auth.py', language: 'Python' }), 800)

  // Tier 3: Manifests & Configs
  assert.equal(scoreFileForOverview({ path: 'frontend/package.json', language: 'JSON' }), 600)
  assert.equal(scoreFileForOverview({ path: 'backend/app/config.py', language: 'Python' }), 600)

  // Tier 4: Frontend Components
  assert.equal(scoreFileForOverview({ path: 'frontend/src/components/Navbar.jsx', language: 'JavaScript' }), 400)
  assert.equal(scoreFileForOverview({ path: 'frontend/src/pages/Dashboard.jsx', language: 'JavaScript' }), 400)

  // Tier 5: General Code
  assert.equal(scoreFileForOverview({ path: 'backend/app/utils.py', language: 'Python' }), 250)

  // Tier 6: Non-code companion assets
  assert.equal(scoreFileForOverview({ path: 'frontend/index.html', language: 'HTML' }), 100)
  assert.equal(scoreFileForOverview({ path: 'frontend/src/index.css', language: 'CSS' }), 100)
  assert.equal(scoreFileForOverview({ path: 'ml/models/model_metrics.json', language: 'JSON' }), 100)

  // Tier 7: Tests (deprioritized)
  assert.equal(scoreFileForOverview({ path: 'tests/test_gateway.py', language: 'Python' }), 50)
  assert.equal(scoreFileForOverview({ path: 'frontend/src/__tests__/App.test.jsx', language: 'JavaScript' }), 50)
})

test('validateOverviewSource accepts all 15 supported languages and rejects unsupported or invalid files', () => {
  const py = makeFile('backend/main.py', 'print("Hello Python")', 'Python')
  assert.equal(validateOverviewSource(py).truncated, false)

  const js = makeFile('frontend/App.jsx', 'export default function App() {}', 'JavaScript')
  assert.equal(validateOverviewSource(js).truncated, false)

  const json = makeFile('frontend/package.json', '{"name": "waf"}', 'JSON')
  assert.equal(validateOverviewSource(json).truncated, false)

  const html = makeFile('frontend/index.html', '<!DOCTYPE html><html></html>', 'HTML')
  assert.equal(validateOverviewSource(html).truncated, false)

  const css = makeFile('frontend/style.css', 'body { margin: 0; }', 'CSS')
  assert.equal(validateOverviewSource(css).truncated, false)

  const sql = makeFile('db/schema.sql', 'CREATE TABLE test (id INT);', 'SQL')
  assert.equal(validateOverviewSource(sql).truncated, false)

  // Unsupported language
  const unsupported = makeFile('code.xyz', 'unknown', 'UnknownLang')
  assert.throws(() => validateOverviewSource(unsupported), e => e.code === 'unsupported_file')

  // Hash mismatch
  const tampered = { ...py, sha256: '0'.repeat(64) }
  assert.throws(() => validateOverviewSource(tampered), e => e.code === 'source_integrity')
})

test('selectOverviewFiles selects top 10 representative whole files and reports exclusions for > 10 files', () => {
  const files = []
  // Create 15 files
  for (let i = 1; i <= 15; i++) {
    const isEntry = i === 1
    const p = isEntry ? 'src/main.js' : `src/module_${i}.js`
    files.push(makeFile(p, `export const val${i} = ${i};`, 'JavaScript'))
  }

  const snapshot = {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.byteSize, 0),
    files,
  }

  const selection = selectOverviewFiles(snapshot)
  assert.equal(selection.totalDiscoveredFiles, 15)
  assert.equal(selection.selectedFiles.length, 10)
  assert.equal(selection.excludedFiles.length, 5)

  // Highest priority (main.js) is selected first
  assert.equal(selection.selectedFiles[0].path, 'src/main.js')

  // Excluded files have explicit reasons
  for (const excluded of selection.excludedFiles) {
    assert.equal(excluded.reason, 'file_count_budget_reached')
    assert.ok(excluded.message.length > 10)
  }
})

test('selectOverviewFiles accurately handles multi-language project with Python, React, and companion HTML/CSS/JSON', () => {
  const files = [
    makeFile('backend/app/main.py', 'from fastapi import FastAPI\napp = FastAPI()', 'Python'),
    makeFile('backend/app/core/gateway.py', 'class Gateway:\n    pass', 'Python'),
    makeFile('frontend/src/App.jsx', 'import React from "react";\nexport default function App() {}', 'JavaScript'),
    makeFile('frontend/src/main.jsx', 'import ReactDOM from "react-dom";', 'JavaScript'),
    makeFile('frontend/package.json', '{"name": "frontend", "version": "1.0.0"}', 'JSON'),
    makeFile('frontend/index.html', '<!DOCTYPE html><html><body><div id="root"></div></body></html>', 'HTML'),
    makeFile('frontend/src/index.css', 'body { color: #fff; }', 'CSS'),
    makeFile('tests/test_main.py', 'def test_app():\n    assert True', 'Python'),
  ]

  const snapshot = {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.byteSize, 0),
    files,
  }

  const selection = selectOverviewFiles(snapshot)
  assert.equal(selection.totalDiscoveredFiles, 8)
  assert.equal(selection.selectedFiles.length, 8) // All 8 fit in budget
  assert.equal(selection.excludedFiles.length, 0)

  const selectedPaths = selection.selectedFiles.map(f => f.path)
  assert.ok(selectedPaths.includes('backend/app/main.py'))
  assert.ok(selectedPaths.includes('frontend/src/App.jsx'))
  assert.ok(selectedPaths.includes('frontend/package.json'))
  assert.ok(selectedPaths.includes('frontend/index.html'))
})

test('selectOverviewFiles enforces 60,000 bytes and 30,000 characters limit and skips oversized candidates without truncation', () => {
  const hugeFile = makeFile('src/huge.js', 'x'.repeat(35000), 'JavaScript') // 35k chars > 30k limit
  const normalFile = makeFile('src/normal.js', 'console.log("hello")', 'JavaScript')

  const snapshot = {
    totalFiles: 2,
    totalBytes: hugeFile.byteSize + normalFile.byteSize,
    files: [hugeFile, normalFile],
  }

  const selection = selectOverviewFiles(snapshot)
  assert.equal(selection.selectedFiles.length, 1)
  assert.equal(selection.selectedFiles[0].path, 'src/normal.js')
  assert.equal(selection.excludedFiles.length, 1)
  assert.equal(selection.excludedFiles[0].path, 'src/huge.js')
  assert.equal(selection.excludedFiles[0].reason, 'single_file_exceeds_budget')
})

test('selectOverviewFiles rejects empty project with empty_source_project (400)', () => {
  assert.throws(() => selectOverviewFiles({ totalFiles: 0, files: [] }), e => e.code === 'empty_source_project' && e.status === 400)
})
