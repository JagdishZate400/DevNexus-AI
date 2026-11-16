require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

const { extractEvidence, evidencePath, LIMITS: EVIDENCE_LIMITS } = require('../src/services/documentEvidence')
const { specification, responseSchema } = require('../src/services/documentSpecifications')
const { buildCatalog, promptCatalog, validateOrganization, renderDocument, LIMITS: CATALOG_LIMITS } = require('../src/services/documentCatalog')
const { scoreFileForOverview } = require('../src/services/documentOverviewSelection')
const { generateDocument } = require('../src/services/documentDispatch')
const { durableFixture } = require('./helpers/document-durable')
const config = require('../src/config')

function file(path, content, storageKind = 'source') {
  return {
    id: crypto.randomUUID(),
    path,
    content,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    storageKind,
  }
}

function success(organization) {
  return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(organization) }] } }] }))
}

function organize(options) {
  const catalog = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text)
  const sections = []
  for (const fact of catalog.facts.slice(0, 12)) {
    let section = sections.find(s => s.title === fact.section)
    if (!section) {
      section = { title: fact.section, claims: [] }
      sections.push(section)
    }
    section.claims.push({ factId: fact.factId, explanation: fact.explanations[0] })
  }
  return { sections }
}

async function network(fetch, run) {
  const oldFetch = global.fetch
  const prior = {
    aiProvider: config.aiProvider,
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel,
    geminiTimeoutMs: config.geminiTimeoutMs,
  }
  Object.assign(config, { aiProvider: 'gemini', geminiApiKey: 'fixture-key', geminiModel: 'fixture', geminiTimeoutMs: 2000 })
  global.fetch = fetch
  try {
    return await run()
  } finally {
    global.fetch = oldFetch
    Object.assign(config, prior)
  }
}

test('Python requirements.txt manifest extraction parses package names, ranges, and accurate line numbers', () => {
  const content = `# Backend requirements
fastapi>=0.100.0
uvicorn[standard]>=0.23.0
pydantic>=2.0.0
scikit-learn==1.3.0
joblib>=1.3.0
# Comment line
requests
--extra-index-url https://example.com/simple
`
  const reqFile = file('requirements.txt', content, 'documentation-evidence')
  assert.equal(evidencePath(reqFile.path), 'manifest')

  const analysis = extractEvidence([reqFile])
  const manifest = analysis.files[0]
  assert.equal(manifest.kind, 'manifest')
  assert.equal(manifest.dependencies.length, 6)

  const fastapi = manifest.dependencies.find(d => d.name === 'fastapi')
  assert.ok(fastapi)
  assert.equal(fastapi.declaredRange, '>=0.100.0')
  assert.equal(fastapi.reference.lineStart, 2)
  assert.equal(fastapi.reference.lineEnd, 2)

  const uvicorn = manifest.dependencies.find(d => d.name === 'uvicorn')
  assert.ok(uvicorn)
  assert.equal(uvicorn.declaredRange, '>=0.23.0')
  assert.equal(uvicorn.reference.lineStart, 3)

  const requests = manifest.dependencies.find(d => d.name === 'requests')
  assert.ok(requests)
  assert.equal(requests.declaredRange, '*')
  assert.equal(requests.reference.lineStart, 8)
})

test('Python pyproject.toml manifest extraction parses dependencies from both standard and poetry formats', () => {
  const content = `[project]
name = "sentinelwaf"
version = "0.1.0"
dependencies = [
    "fastapi>=0.100.0",
    "uvicorn>=0.23.0",
]

[tool.poetry.dependencies]
python = "^3.11"
scikit-learn = "^1.3.0"
`
  const tomlFile = file('pyproject.toml', content, 'documentation-evidence')
  assert.equal(evidencePath(tomlFile.path), 'manifest')

  const analysis = extractEvidence([tomlFile])
  const manifest = analysis.files[0]
  assert.equal(manifest.kind, 'manifest')
  assert.ok(manifest.dependencies.length >= 3)

  const fastapi = manifest.dependencies.find(d => d.name === 'fastapi')
  assert.ok(fastapi)
  assert.equal(fastapi.declaredRange, '>=0.100.0')

  const sklearn = manifest.dependencies.find(d => d.name === 'scikit-learn')
  assert.ok(sklearn)
  assert.equal(sklearn.declaredRange, '^1.3.0')
})

test('FastAPI / Flask Python route decorator extraction extracts receiver, method, path, and reference', () => {
  const content = `from fastapi import FastAPI, Depends
app = FastAPI()

@app.get("/api/v1/health")
def health():
    return {"status": "ok"}

@app.post("/api/v1/items")
def create_item():
    return {"status": "created"}
`
  const pyFile = file('backend/app/main.py', content, 'source')
  const analysis = extractEvidence([pyFile])
  const src = analysis.files[0]
  assert.equal(src.routes.length, 2)
  assert.equal(src.routes[0].receiver, 'app')
  assert.equal(src.routes[0].method, 'GET')
  assert.equal(src.routes[0].path, '/api/v1/health')
  assert.equal(src.routes[0].reference.lineStart, 4)

  assert.equal(src.routes[1].receiver, 'app')
  assert.equal(src.routes[1].method, 'POST')
  assert.equal(src.routes[1].path, '/api/v1/items')
  assert.equal(src.routes[1].reference.lineStart, 8)
})

test('README catalog generation succeeds for Python + React project without pre-existing README.md/INSTALL.md', () => {
  const files = [
    file('backend/app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/health")\ndef h(): return 1\n'),
    file('backend/requirements.txt', 'fastapi>=0.100.0\nuvicorn>=0.23.0\n', 'documentation-evidence'),
    file('frontend/package.json', JSON.stringify({ dependencies: { react: '^18.2.0' }, scripts: { dev: 'vite' } }), 'documentation-evidence'),
    file('frontend/src/App.jsx', 'import React from "react";\nexport function App() { return <div>WAF</div>; }\n'),
  ]

  const spec = specification('readme')
  assert.deepEqual(spec.required, [['source']])

  const catalog = buildCatalog({ files }, spec)
  assert.ok(catalog.facts.length > 0)
  assert.ok(catalog.facts.some(f => f.section === 'Static API surface' && f.text.includes('/health')))
  assert.ok(catalog.facts.some(f => f.section === 'Declared dependencies' && f.text.includes('fastapi')))
  assert.ok(catalog.facts.some(f => f.section === 'Declared dependencies' && f.text.includes('react')))
  assert.ok(catalog.unknowns.some(u => u.includes('installation instructions were found')))
})

test('bounded catalog caps candidate facts at 60 without throwing documentation_context_limit', () => {
  // Create 30 source files each declaring multiple symbols and imports to produce > 100 raw candidate facts
  const files = []
  for (let i = 0; i < 30; i++) {
    files.push(file(`src/module_${i}.py`, `import os\nimport sys\ndef func_${i}_a(): pass\ndef func_${i}_b(): pass\nclass Service_${i}: pass\n`))
  }
  files.push(file('requirements.txt', 'fastapi>=0.100.0\nuvicorn>=0.23.0\n', 'documentation-evidence'))

  const spec = specification('readme')
  const catalog = buildCatalog({ files }, spec)
  assert.ok(catalog.facts.length <= CATALOG_LIMITS.facts)
  assert.ok(catalog.citations.length <= CATALOG_LIMITS.citations)

  const context = promptCatalog(catalog)
  assert.ok(Buffer.byteLength(context) <= CATALOG_LIMITS.promptBytes)
  assert.ok(context.length <= CATALOG_LIMITS.promptCharacters)
})

test('single file exceeding LIMITS.fileBytes (64 KiB) is rejected with context_limit (413)', () => {
  const huge = file('huge.py', 'x = 1\n'.repeat(35000)) // ~245,000 bytes > 65,536
  assert.throws(() => extractEvidence([huge]), { code: 'context_limit' })
})

test('complete simulated multi-language README generation with mock provider persists valid markdown and citations', async () => {
  const files = [
    file('backend/app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/health")\ndef h(): return 1\n'),
    file('backend/requirements.txt', 'fastapi>=0.100.0\n', 'documentation-evidence'),
    file('frontend/package.json', JSON.stringify({ dependencies: { react: '^18.2.0' } }), 'documentation-evidence'),
    file('frontend/src/App.jsx', 'export function App() { return 1; }\n'),
  ]

  const f = durableFixture()
  f.files.splice(0)
  f.metadata.splice(0)
  for (const r of files) {
    (r.storageKind === 'source' ? f.files : f.metadata).push({
      fileId: r.id,
      path: r.path,
      hash: r.sha256,
      byteSize: Buffer.byteLength(r.content),
    })
  }

  const evidence = {
    async generationSnapshot(projectId, ownerId) {
      return { files: structuredClone(files), analysis: extractEvidence(files) }
    },
  }
  const sources = {
    async findProject(projectId, ownerId) {
      return projectId === 'owned' && ownerId === f.owner ? { id: 'owned' } : null
    },
  }

  await network(
    async (url, options) => success(organize(options)),
    async () => {
      const doc = await generateDocument({
        input: { projectId: 'owned', documentType: 'readme' },
        ownerId: f.owner,
        sources,
        documents: f.repo,
        evidence,
        diagnostic() {},
      })
      assert.equal(doc.documentType, 'readme')
      assert.equal(doc.generationStatus, 'Completed')
      assert.match(doc.markdown, /# README/)
      assert.match(doc.markdown, /AI-organized observations/)
      assert.match(doc.markdown, /Deterministic evidence inventory/)
      assert.match(doc.markdown, /Unknowns and limitations/)
      assert.ok(doc.sourceReferences.length > 0)
    }
  )
})

test('Installation Guide generation succeeds with package.json and no README.md/INSTALL.md', async () => {
  const files = [
    file('frontend/package.json', JSON.stringify({
      dependencies: { react: '^18.2.0', axios: '^1.6.0' },
      scripts: { dev: 'vite', build: 'vite build' },
    }), 'documentation-evidence'),
    file('frontend/src/main.jsx', 'import React from "react";\nexport function Main() { return 1; }\n', 'source'),
  ]

  const spec = specification('installation-guide')
  assert.deepEqual(spec.required, [['manifest']])

  const catalog = buildCatalog({ files }, spec)
  assert.ok(catalog.facts.length > 0)
  assert.ok(catalog.facts.some(f => f.section === 'Declared dependencies' && f.text.includes('react')))
  assert.ok(catalog.facts.some(f => f.section === 'Declared package scripts' && f.text.includes('dev')))
  assert.ok(!catalog.facts.some(f => f.section === 'Source-evidenced installation steps'))
  assert.ok(catalog.unknowns.some(u => u.includes('No supported source-evidenced installation instructions were found.')))

  const f = durableFixture()
  f.files.splice(0)
  f.metadata.splice(0)
  for (const r of files) {
    (r.storageKind === 'source' ? f.files : f.metadata).push({
      fileId: r.id,
      path: r.path,
      hash: r.sha256,
      byteSize: Buffer.byteLength(r.content),
    })
  }

  const evidence = {
    async generationSnapshot(projectId, ownerId) {
      return { files: structuredClone(files), analysis: extractEvidence(files) }
    },
  }
  const sources = {
    async findProject(projectId, ownerId) {
      return projectId === 'owned' && ownerId === f.owner ? { id: 'owned' } : null
    },
  }

  await network(
    async (url, options) => success(organize(options)),
    async () => {
      const doc = await generateDocument({
        input: { projectId: 'owned', documentType: 'installation-guide' },
        ownerId: f.owner,
        sources,
        documents: f.repo,
        evidence,
        diagnostic() {},
      })
      assert.equal(doc.documentType, 'installation-guide')
      assert.equal(doc.generationStatus, 'Completed')
      assert.match(doc.markdown, /# Installation Guide/)
      assert.match(doc.markdown, /### Source-evidenced installation steps\nEvidence unavailable for this section\./)
      assert.match(doc.markdown, /### Declared dependencies/)
      assert.match(doc.markdown, /### Declared package scripts/)
      assert.match(doc.markdown, /No supported source-evidenced installation instructions were found\./)
      assert.ok(doc.sourceReferences.length > 0)
    }
  )
})

test('Installation Guide generation succeeds with Python requirements.txt manifest', async () => {
  const files = [
    file('backend/requirements.txt', 'fastapi>=0.100.0\nuvicorn>=0.23.0\npydantic>=2.0.0\n', 'documentation-evidence'),
    file('backend/app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n', 'source'),
  ]

  const spec = specification('installation-guide')
  const catalog = buildCatalog({ files }, spec)
  assert.ok(catalog.facts.length > 0)
  const deps = catalog.facts.filter(f => f.section === 'Declared dependencies')
  assert.ok(deps.some(d => d.text.includes('fastapi')))
  assert.ok(deps.some(d => d.text.includes('uvicorn')))
  assert.ok(deps.some(d => d.text.includes('pydantic')))

  const f = durableFixture()
  f.files.splice(0)
  f.metadata.splice(0)
  for (const r of files) {
    (r.storageKind === 'source' ? f.files : f.metadata).push({
      fileId: r.id,
      path: r.path,
      hash: r.sha256,
      byteSize: Buffer.byteLength(r.content),
    })
  }

  const evidence = {
    async generationSnapshot(projectId, ownerId) {
      return { files: structuredClone(files), analysis: extractEvidence(files) }
    },
  }
  const sources = {
    async findProject(projectId, ownerId) {
      return projectId === 'owned' && ownerId === f.owner ? { id: 'owned' } : null
    },
  }

  await network(
    async (url, options) => success(organize(options)),
    async () => {
      const doc = await generateDocument({
        input: { projectId: 'owned', documentType: 'installation-guide' },
        ownerId: f.owner,
        sources,
        documents: f.repo,
        evidence,
        diagnostic() {},
      })
      assert.equal(doc.documentType, 'installation-guide')
      assert.equal(doc.generationStatus, 'Completed')
      assert.match(doc.markdown, /# Installation Guide/)
      assert.match(doc.markdown, /fastapi/)
      assert.match(doc.markdown, /uvicorn/)
      assert.match(doc.markdown, /Evidence unavailable for this section\./)
    }
  )
})

test('Installation Guide generation succeeds with Python pyproject.toml manifest', async () => {
  const tomlContent = `[project]
name = "sentinelwaf"
version = "0.1.0"
dependencies = [
    "fastapi>=0.100.0",
    "scikit-learn>=1.3.0",
]
`
  const files = [
    file('pyproject.toml', tomlContent, 'documentation-evidence'),
    file('src/main.py', 'import sys\n', 'source'),
  ]

  const spec = specification('installation-guide')
  const catalog = buildCatalog({ files }, spec)
  assert.ok(catalog.facts.some(f => f.section === 'Declared dependencies' && f.text.includes('fastapi')))
  assert.ok(catalog.facts.some(f => f.section === 'Declared dependencies' && f.text.includes('scikit-learn')))
})

test('Installation Guide includes source-evidenced setup commands when supported setup documentation is present', async () => {
  const files = [
    file('package.json', JSON.stringify({
      dependencies: { express: '^4.18.0' },
      scripts: { start: 'node app.js' },
    }), 'documentation-evidence'),
    file('README.md', '# Setup\n```sh\nnpm run start\n```\n', 'documentation-evidence'),
    file('app.js', 'console.log("hello");\n', 'source'),
  ]

  const spec = specification('installation-guide')
  const catalog = buildCatalog({ files }, spec)
  const instructions = catalog.facts.filter(f => f.section === 'Source-evidenced installation steps')
  assert.equal(instructions.length, 1)
  assert.ok(instructions[0].text.includes('npm run start'))
  assert.ok(!catalog.unknowns.some(u => u.includes('No supported source-evidenced installation instructions were found.')))

  const f = durableFixture()
  f.files.splice(0)
  f.metadata.splice(0)
  for (const r of files) {
    (r.storageKind === 'source' ? f.files : f.metadata).push({
      fileId: r.id,
      path: r.path,
      hash: r.sha256,
      byteSize: Buffer.byteLength(r.content),
    })
  }

  const evidence = {
    async generationSnapshot(projectId, ownerId) {
      return { files: structuredClone(files), analysis: extractEvidence(files) }
    },
  }
  const sources = {
    async findProject(projectId, ownerId) {
      return projectId === 'owned' && ownerId === f.owner ? { id: 'owned' } : null
    },
  }

  await network(
    async (url, options) => success(organize(options)),
    async () => {
      const doc = await generateDocument({
        input: { projectId: 'owned', documentType: 'installation-guide' },
        ownerId: f.owner,
        sources,
        documents: f.repo,
        evidence,
        diagnostic() {},
      })
      assert.equal(doc.documentType, 'installation-guide')
      assert.equal(doc.generationStatus, 'Completed')
      assert.match(doc.markdown, /npm run start/)
      assert.ok(!doc.markdown.includes('### Source-evidenced installation steps\nEvidence unavailable for this section.'))
    }
  )
})

test('Installation Guide strictly rejects projects with no manifests with documentation_evidence_insufficient (HTTP 400)', async () => {
  const files = [
    file('backend/main.py', 'print("hello")\n', 'source'),
    file('backend/utils.py', 'def helper(): pass\n', 'source'),
  ]

  const spec = specification('installation-guide')
  assert.throws(() => buildCatalog({ files }, spec), { code: 'documentation_evidence_insufficient' })

  const f = durableFixture()
  f.files.splice(0)
  f.metadata.splice(0)
  for (const r of files) {
    f.files.push({
      fileId: r.id,
      path: r.path,
      hash: r.sha256,
      byteSize: Buffer.byteLength(r.content),
    })
  }

  const evidence = {
    async generationSnapshot(projectId, ownerId) {
      return { files: structuredClone(files), analysis: extractEvidence(files) }
    },
  }
  const sources = {
    async findProject(projectId, ownerId) {
      return projectId === 'owned' && ownerId === f.owner ? { id: 'owned' } : null
    },
  }

  await assert.rejects(
    generateDocument({
      input: { projectId: 'owned', documentType: 'installation-guide' },
      ownerId: f.owner,
      sources,
      documents: f.repo,
      evidence,
      diagnostic() {},
    }),
    { code: 'documentation_evidence_insufficient', status: 400 }
  )
})

test('Installation Guide distinguishes declared dependencies, scripts, and source-evidenced setup commands', () => {
  const files = [
    file('package.json', JSON.stringify({
      dependencies: { express: '^4.18.0' },
      scripts: { start: 'node index.js' },
      engines: { node: '>=18' },
    }), 'documentation-evidence'),
    file('README.md', '```sh\nnpm run start\n```\n', 'documentation-evidence'),
    file('index.js', 'console.log(1);\n', 'source'),
  ]

  const spec = specification('installation-guide')
  const catalog = buildCatalog({ files }, spec)

  const depFact = catalog.facts.find(f => f.section === 'Declared dependencies')
  assert.ok(depFact)
  assert.equal(depFact.classification, 'verified-artifact')

  const scriptFact = catalog.facts.find(f => f.section === 'Declared package scripts')
  assert.ok(scriptFact)
  assert.equal(scriptFact.classification, 'declared-untested')

  const engineFact = catalog.facts.find(f => f.section === 'Declared prerequisites')
  assert.ok(engineFact)
  assert.equal(engineFact.classification, 'declared-untested')

  const instructionFact = catalog.facts.find(f => f.section === 'Source-evidenced installation steps')
  assert.ok(instructionFact)
  assert.equal(instructionFact.classification, 'declared-untested')
})
