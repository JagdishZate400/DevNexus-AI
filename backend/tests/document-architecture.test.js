require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

const { specification, responseSchema } = require('../src/services/documentSpecifications')
const { buildCatalog, promptCatalog, validateOrganization, renderDocument, LIMITS: CATALOG_LIMITS } = require('../src/services/documentCatalog')
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

function createSentinelWAFSampleFiles() {
  return [
    file('backend/app/main.py', `from fastapi import FastAPI, Depends, Request
from app.core.auth import require_admin_auth
from app.core.gateway import forward_request

app = FastAPI(title="SentinelWAF AI")

@app.get("/api/v1/health")
def health_check():
    return {"status": "ok"}

@app.get("/api/v1/security/events", dependencies=[Depends(require_admin_auth)])
def get_security_events():
    return []

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def reverse_proxy(request: Request, path: str):
    return await forward_request(request)

def sanitize_csv_cell(val: str) -> str:
    return val.strip()
`),
    file('backend/app/core/gateway.py', `from fastapi import Request, HTTPException, status
from app.core.normalizer import extract_and_normalize_request
from app.core.rule_engine import inspect_request
from app.core.ml_engine import predict_payload
from app.core.decision_engine import evaluate_request_policy
from app.db.repository import insert_security_event

async def forward_request(request: Request):
    normalized = extract_and_normalize_request(request)
    rule_res = inspect_request(normalized)
    ml_res = predict_payload(normalized.body)
    decision = evaluate_request_policy(rule_res, ml_res)
    if decision.action == "BLOCK":
        insert_security_event(decision)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Blocked by WAF")
    return {"action": "FORWARD"}
`),
    file('backend/app/core/normalizer.py', `class NormalizedRequest:
    def __init__(self, path, body):
        self.path = path
        self.body = body

def extract_and_normalize_request(request):
    return NormalizedRequest(request.url.path, "normalized")
`),
    file('backend/app/core/rule_engine.py', `class DetectionResult:
    def __init__(self, score, signatures):
        self.score = score
        self.signatures = signatures

def inspect_request(normalized):
    return DetectionResult(0.0, [])
`),
    file('backend/app/core/ml_engine.py', `import joblib

class MLInferenceResult:
    def __init__(self, anomaly_score):
        self.anomaly_score = anomaly_score

def predict_payload(payload):
    return MLInferenceResult(0.1)
`),
    file('backend/app/core/decision_engine.py', `from app.core.rule_engine import DetectionResult
from app.core.ml_engine import MLInferenceResult

class PolicyDecision:
    def __init__(self, action, risk_score):
        self.action = action
        self.risk_score = risk_score

def evaluate_request_policy(rule_res: DetectionResult, ml_res: MLInferenceResult):
    risk = (0.6 * rule_res.score) + (0.4 * ml_res.anomaly_score)
    action = "BLOCK" if risk >= 65 else "ALLOW"
    return PolicyDecision(action, risk)
`),
    file('backend/app/core/auth.py', `from fastapi import Header, HTTPException

def require_admin_auth(x_api_key: str = Header(None)):
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True
`),
    file('backend/app/db/database.py', `import sqlite3

def init_db():
    conn = sqlite3.connect("sentinelwaf.db")
    conn.execute("CREATE TABLE IF NOT EXISTS security_events (id TEXT PRIMARY KEY)")
    conn.close()
`),
    file('backend/app/db/repository.py', `from app.db.database import init_db

def insert_security_event(event):
    pass
`),
    file('backend/app/models/models.py', `from dataclasses import dataclass

@dataclass
class SecurityEventRecord:
    id: str
    action: str
    risk_score: float
`),
    file('frontend/package.json', JSON.stringify({
      name: 'sentinelwaf-frontend',
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        recharts: '^2.12.0',
      },
      scripts: { dev: 'vite', build: 'vite build' },
    }, null, 2)),
    file('frontend/src/App.jsx', `import React from 'react';

export default function App() {
  return (
    <div className="dashboard">
      <h1>SentinelWAF AI Management Dashboard</h1>
    </div>
  );
}
`),
    file('frontend/src/services/api.js', `export async function fetchHealth() {
  const res = await fetch('/api/v1/health');
  return res.json();
}

export async function fetchSecurityEvents() {
  const res = await fetch('/api/v1/security/events');
  return res.json();
}
`),
  ]
}

function sampleExpressFiles() {
  return [
    file('src/app.js', `import express from 'express';
const app = express();
const router = express.Router();
export function greet(name) { return name; }
router.get('/items', greet);
app.use('/api', router);
const port = process.env.PORT;
export default app;`),
    file('package.json', JSON.stringify({
      dependencies: { express: '^4.0.0' },
      scripts: { start: 'node src/app.js' },
      engines: { node: '>=20' },
    }, null, 2)),
    file('package-lock.json', JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/express': { version: '4.0.0' } },
    }, null, 2)),
    file('README.md', '# Setup\n```sh\nnpm ci\nnpm run start\n```\n'),
    file('.env.example', 'PORT=\nDATABASE_URL=\n'),
  ]
}

test('architecture specification defines the 8 canonical observation sections', () => {
  const spec = specification('architecture')
  assert.ok(spec)
  assert.equal(spec.id, 'architecture')
  assert.equal(spec.title, 'Architecture Documentation')

  const sectionValues = [...new Set(Object.values(spec.sections))]
  assert.ok(sectionValues.includes('System Overview'))
  assert.ok(sectionValues.includes('High-Level Architecture'))
  assert.ok(sectionValues.includes('Component Responsibilities'))
  assert.ok(sectionValues.includes('Request Processing Flow'))
  assert.ok(sectionValues.includes('Frontend–Backend Communication'))
  assert.ok(sectionValues.includes('Data Storage'))
  assert.ok(sectionValues.includes('Security Architecture'))
  assert.ok(sectionValues.includes('Technology Stack'))
})

test('architecture catalog extracts verified multi-tier architectural relationships for SentinelWAF AI', () => {
  const spec = specification('architecture')
  const files = createSentinelWAFSampleFiles()
  const snapshot = { files }
  const catalog = buildCatalog(snapshot, spec)

  assert.ok(catalog.facts.length >= 25, `Expected >= 25 facts, got ${catalog.facts.length}`)
  assert.ok(catalog.citations.length <= CATALOG_LIMITS.citations, `Expected <= 60 citations, got ${catalog.citations.length}`)

  const sections = new Set(catalog.facts.map(f => f.section))
  assert.ok(sections.has('System Overview'))
  assert.ok(sections.has('High-Level Architecture'))
  assert.ok(sections.has('Component Responsibilities'))
  assert.ok(sections.has('Request Processing Flow'))
  assert.ok(sections.has('Frontend–Backend Communication'))
  assert.ok(sections.has('Data Storage'))
  assert.ok(sections.has('Security Architecture'))
  assert.ok(sections.has('Technology Stack'))

  // Verify specific architectural extractions
  const dualTier = catalog.facts.find(f => f.text.includes('dual-tier architecture'))
  assert.ok(dualTier, 'Dual tier architecture fact should be extracted')
  assert.equal(dualTier.classification, 'directly-verified')
  assert.equal(dualTier.references.length, 2, 'Should cite both backend and frontend entry points')

  const delegation = catalog.facts.find(f => f.text.includes('delegates policy resolution'))
  assert.ok(delegation, 'Gateway to decision engine delegation should be extracted')
  assert.equal(delegation.classification, 'directly-verified')

  const stage1 = catalog.facts.find(f => f.text.includes('Request pipeline stage 1'))
  assert.ok(stage1, 'Request pipeline stage 1 should be extracted')
  assert.equal(stage1.classification, 'directly-verified')

  const clientApi = catalog.facts.find(f => f.text.includes('frontend/src/services/api.js issues client fetch requests'))
  assert.ok(clientApi, 'Frontend-backend API communication should be extracted')
  assert.equal(clientApi.references.length, 2, 'Should cite both frontend client and backend route')

  const storage = catalog.facts.find(f => f.text.includes('initializes SQLite database'))
  assert.ok(storage, 'SQLite storage fact should be extracted')

  const wafBlock = catalog.facts.find(f => f.text.includes('enforces WAF blocking policy returning HTTP 403'))
  assert.ok(wafBlock, 'WAF blocking fact should be extracted')
})

test('architecture document renders diagrams, renderer notice, and all required sections', () => {
  const spec = specification('architecture')
  const files = createSentinelWAFSampleFiles()
  const snapshot = { files }
  const catalog = buildCatalog(snapshot, spec)

  // Select up to 12 facts across different sections
  const selectedSections = []
  const seen = new Set()
  for (const f of catalog.facts) {
    if (selectedSections.length >= 8) break
    if (!seen.has(f.section)) {
      seen.add(f.section)
      selectedSections.push({
        title: f.section,
        claims: [{ factId: f.id, explanation: f.explanations[0] }],
      })
    }
  }

  const validSections = validateOrganization(JSON.stringify({ sections: selectedSections }), catalog, spec)
  const markdown = renderDocument(spec, catalog, validSections)

  // 1. Title and Evidence Scope
  assert.ok(markdown.includes('# Architecture Documentation'))
  assert.ok(markdown.includes('## Evidence scope'))

  // 2. Dedicated Architecture Diagram section with Mermaid + Text and Renderer Notice
  assert.ok(markdown.includes('## Architecture Diagram'))
  assert.ok(markdown.includes('Renderer Notice:'))
  assert.ok(markdown.includes('### Mermaid Architecture Diagram'))
  assert.ok(markdown.includes('```mermaid'))
  assert.ok(markdown.includes('flowchart TD'))
  assert.ok(markdown.includes('Gateway["Reverse Proxy Gateway (backend/app/core/gateway.py)"]'))
  assert.ok(markdown.includes('### Text-Based Architecture Diagram'))
  assert.ok(markdown.includes('```text'))
  assert.ok(markdown.includes('Reverse Proxy Gateway'))

  // 3. AI-organized observations and Deterministic inventory
  assert.ok(markdown.includes('## AI-organized observations'))
  assert.ok(markdown.includes('## Deterministic evidence inventory'))
  assert.ok(markdown.includes('### System Overview'))
  assert.ok(markdown.includes('### High-Level Architecture'))
  assert.ok(markdown.includes('### Component Responsibilities'))
  assert.ok(markdown.includes('### Request Processing Flow'))
  assert.ok(markdown.includes('### Frontend–Backend Communication'))
  assert.ok(markdown.includes('### Data Storage'))
  assert.ok(markdown.includes('### Security Architecture'))
  assert.ok(markdown.includes('### Technology Stack'))

  // 4. Unknowns and limitations & snapshot references
  assert.ok(markdown.includes('## Unknowns and limitations'))
  assert.ok(markdown.includes('## Snapshot references'))
})

test('architecture generation succeeds cleanly on standard Express projects without regression', () => {
  const spec = specification('architecture')
  const files = sampleExpressFiles()
  const snapshot = { files }
  const catalog = buildCatalog(snapshot, spec)

  assert.ok(catalog.facts.length > 0)
  assert.ok(catalog.citations.length > 0)

  const selectedFact = catalog.facts[0]
  const validSections = validateOrganization(
    JSON.stringify({
      sections: [{
        title: selectedFact.section,
        claims: [{ factId: selectedFact.id, explanation: selectedFact.explanations[0] }],
      }],
    }),
    catalog,
    spec
  )

  const markdown = renderDocument(spec, catalog, validSections)
  assert.ok(markdown.includes('# Architecture Documentation'))
  assert.ok(markdown.includes('## Architecture Diagram'))
  assert.ok(markdown.includes('```mermaid'))
  assert.ok(markdown.includes('Express Application'))
  assert.ok(markdown.includes('```text'))
  assert.ok(markdown.includes('## Unknowns and limitations'))
})

test('bounded architecture catalog respects context and citation limits', () => {
  const spec = specification('architecture')
  const files = createSentinelWAFSampleFiles()
  const snapshot = { files }
  const catalog = buildCatalog(snapshot, spec)

  assert.ok(catalog.facts.length <= CATALOG_LIMITS.facts)
  assert.ok(catalog.citations.length <= CATALOG_LIMITS.citations)

  const promptContext = promptCatalog(catalog)
  assert.ok(promptContext.length <= 30000)
  assert.ok(Buffer.byteLength(promptContext) <= 60000)
})

test('validateOrganization rejects invalid facts, wrong sections, and duplicate claims', () => {
  const spec = specification('architecture')
  const files = createSentinelWAFSampleFiles()
  const snapshot = { files }
  const catalog = buildCatalog(snapshot, spec)

  // 1. Invented fact ID
  assert.throws(() => {
    validateOrganization(JSON.stringify({
      sections: [{
        title: 'System Overview',
        claims: [{ factId: 'F999', explanation: 'Invented' }],
      }],
    }), catalog, spec)
  }, { code: 'ai_malformed_response' })

  // 2. Fact in wrong section
  const fact = catalog.facts.find(f => f.section === 'Data Storage')
  assert.throws(() => {
    validateOrganization(JSON.stringify({
      sections: [{
        title: 'System Overview',
        claims: [{ factId: fact.id, explanation: fact.explanations[0] }],
      }],
    }), catalog, spec)
  }, { code: 'ai_malformed_response' })

  // 3. Duplicate fact
  assert.throws(() => {
    validateOrganization(JSON.stringify({
      sections: [{
        title: fact.section,
        claims: [
          { factId: fact.id, explanation: fact.explanations[0] },
          { factId: fact.id, explanation: fact.explanations[0] },
        ],
      }],
    }), catalog, spec)
  }, { code: 'ai_malformed_response' })
})

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

test('complete simulated multi-tier Architecture documentation generation with mock provider persists valid markdown and diagrams', async () => {
  const files = createSentinelWAFSampleFiles()
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

  const { extractEvidence } = require('../src/services/documentEvidence')
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
        input: { projectId: 'owned', documentType: 'architecture' },
        ownerId: f.owner,
        sources,
        documents: f.repo,
        evidence,
        diagnostic() {},
      })
      assert.equal(doc.documentType, 'architecture')
      assert.equal(doc.generationStatus, 'Completed')
      assert.match(doc.markdown, /# Architecture Documentation/)
      assert.match(doc.markdown, /## Architecture Diagram/)
      assert.match(doc.markdown, /```mermaid/)
      assert.match(doc.markdown, /flowchart TD/)
      assert.match(doc.markdown, /Reverse Proxy Gateway/)
      assert.match(doc.markdown, /```text/)
      assert.match(doc.markdown, /Renderer Notice:/)
      assert.match(doc.markdown, /### System Overview/)
      assert.match(doc.markdown, /### High-Level Architecture/)
      assert.match(doc.markdown, /### Component Responsibilities/)
      assert.match(doc.markdown, /### Request Processing Flow/)
      assert.match(doc.markdown, /### Frontend–Backend Communication/)
      assert.match(doc.markdown, /### Data Storage/)
      assert.match(doc.markdown, /### Security Architecture/)
      assert.match(doc.markdown, /### Technology Stack/)
      assert.match(doc.markdown, /## Unknowns and limitations/)
    }
  )
})

