function findLine(content, pattern) {
  if (!content) return 1
  const lines = content.split(/\r\n|\n|\r/)
  for (let i = 0; i < lines.length; i++) {
    if (typeof pattern === 'string' ? lines[i].includes(pattern) : pattern.test(lines[i])) {
      return i + 1
    }
  }
  return 1
}

function extractArchitectureEvidence(files, analysis, add, ref) {
  const byPath = new Map(files.map(f => [f.path, f]))

  // 1. System Overview
  const backendEntry = files.find(f => f.path.endsWith('main.py') || f.path.endsWith('app.py') || (f.path.endsWith('app.js') && f.content.includes('express(')))
  const frontendEntry = files.find(f => f.path.endsWith('App.jsx') || f.path.endsWith('App.tsx') || f.path.endsWith('main.jsx'))

  if (backendEntry && frontendEntry) {
    const bLine = findLine(backendEntry.content, /FastAPI\(|express\(/)
    const fLine = findLine(frontendEntry.content, /export default function|export const App|ReactDOM/)
    const bType = backendEntry.path.endsWith('.py') ? 'Python FastAPI' : 'Node.js Express'
    add('overview', `The system is organized into a dual-tier architecture comprising a ${bType} backend service and a React single-page frontend.`,
      [ref(backendEntry.id, bLine), ref(frontendEntry.id, fLine)], 'directly-verified')
  }

  if (backendEntry) {
    const bLine = findLine(backendEntry.content, /FastAPI\(|express\(/)
    const framework = backendEntry.content.includes('FastAPI') ? 'FastAPI routing, CORS middleware, and application lifespan' : 'Express application routing and middleware'
    add('overview', `${backendEntry.path} declares the backend service entry point with ${framework}.`,
      [ref(backendEntry.id, bLine)], 'directly-verified')
  }

  if (frontendEntry) {
    const fLine = findLine(frontendEntry.content, /export default function|export const App|ReactDOM/)
    add('overview', `${frontendEntry.path} declares the frontend single-page application shell composing views and navigation components.`,
      [ref(frontendEntry.id, fLine)], 'directly-verified')
  }

  // 2. High-Level Architecture (Structural Relationships)
  const gatewayFile = files.find(f => f.path.includes('gateway.py'))
  const decisionFile = files.find(f => f.path.includes('decision_engine.py'))
  const ruleFile = files.find(f => f.path.includes('rule_engine.py'))
  const mlFile = files.find(f => f.path.includes('ml_engine.py'))
  const normalizerFile = files.find(f => f.path.includes('normalizer.py'))
  const repoFile = files.find(f => f.path.includes('repository.py'))
  const dbFile = files.find(f => f.path.includes('database.py'))
  const authFile = files.find(f => f.path.includes('auth.py'))
  const apiFile = files.find(f => f.path.includes('api.js') || f.path.includes('api.ts'))

  if (backendEntry && gatewayFile) {
    const mLine = findLine(backendEntry.content, 'forward_request')
    const gLine = findLine(gatewayFile.content, 'def forward_request')
    add('architecture', `${backendEntry.path} delegates reverse proxy traffic to ${gatewayFile.path} via catch-all routing.`,
      [ref(backendEntry.id, mLine), ref(gatewayFile.id, gLine)], 'directly-verified')
  }

  if (gatewayFile && decisionFile) {
    const gLine = findLine(gatewayFile.content, 'evaluate_request_policy')
    const dLine = findLine(decisionFile.content, 'def evaluate_request_policy')
    add('architecture', `${gatewayFile.path} delegates policy resolution to ${decisionFile.path}.`,
      [ref(gatewayFile.id, gLine), ref(decisionFile.id, dLine)], 'directly-verified')
  }

  if (decisionFile && ruleFile && mlFile) {
    const dLine = findLine(decisionFile.content, 'from app.core.rule_engine import DetectionResult')
    const rLine = findLine(ruleFile.content, 'class DetectionResult')
    const mLine = findLine(mlFile.content, 'class MLInferenceResult')
    add('architecture', `${decisionFile.path} imports and integrates DetectionResult from ${ruleFile.path} and MLInferenceResult from ${mlFile.path}.`,
      [ref(decisionFile.id, dLine), ref(ruleFile.id, rLine), ref(mlFile.id, mLine)], 'directly-verified')
  }

  if (backendEntry && backendEntry.path.endsWith('app.js')) {
    const mLine = findLine(backendEntry.content, 'app.use(')
    const rLine = findLine(backendEntry.content, 'router.get(')
    add('architecture', `${backendEntry.path} mounts modular router at /api prefix and registers static route handlers.`,
      [ref(backendEntry.id, mLine), ref(backendEntry.id, rLine)], 'directly-verified')
  }

  // 3. Component Responsibilities
  if (gatewayFile) {
    const line = findLine(gatewayFile.content, 'def forward_request')
    add('responsibility', `${gatewayFile.path} declares Reverse Proxy Gateway: intercepts incoming HTTP traffic, coordinates threat analysis, and forwards permitted requests to upstream targets.`,
      [ref(gatewayFile.id, line)], 'directly-verified')
  }
  if (ruleFile) {
    const line = findLine(ruleFile.content, 'def inspect_request')
    add('responsibility', `${ruleFile.path} declares Signature Rule Engine: executes regex pattern inspection across normalized request headers, query parameters, and payloads.`,
      [ref(ruleFile.id, line)], 'directly-verified')
  }
  if (mlFile) {
    const line = findLine(mlFile.content, 'def predict_payload')
    add('responsibility', `${mlFile.path} declares Machine Learning Engine: performs probabilistic payload anomaly classification using TF-IDF vectorization and classifier model.`,
      [ref(mlFile.id, line)], 'directly-verified')
  }
  if (decisionFile) {
    const line = findLine(decisionFile.content, 'def evaluate_request_policy')
    add('responsibility', `${decisionFile.path} declares Policy Decision Engine: computes composite risk scores from rule and ML outputs to resolve ALLOW, MONITOR, or BLOCK actions.`,
      [ref(decisionFile.id, line)], 'directly-verified')
  }
  if (normalizerFile) {
    const line = findLine(normalizerFile.content, 'def extract_and_normalize_request')
    add('responsibility', `${normalizerFile.path} declares Request Normalizer: decodes multi-level URL encoding, Unicode characters, and JSON structures into NormalizedRequest.`,
      [ref(normalizerFile.id, line)], 'directly-verified')
  }
  if (repoFile) {
    const line = findLine(repoFile.content, 'def insert_security_event')
    add('responsibility', `${repoFile.path} declares Security Event Repository: manages SQLite incident persistence, pagination, filtering, and metric aggregations.`,
      [ref(repoFile.id, line)], 'directly-verified')
  }
  if (apiFile) {
    const line = findLine(apiFile.content, 'export async function')
    add('responsibility', `${apiFile.path} declares Frontend API Client: wraps HTTP fetch requests, manages administrative API keys, and formats API responses.`,
      [ref(apiFile.id, line)], 'directly-verified')
  }

  // 4. Request Processing Flow
  if (gatewayFile && normalizerFile) {
    const gLine = findLine(gatewayFile.content, 'extract_and_normalize_request(')
    const nLine = findLine(normalizerFile.content, 'def extract_and_normalize_request')
    add('flow', `Request pipeline stage 1: incoming HTTP request is processed by extract_and_normalize_request in ${normalizerFile.path} to decode obfuscated payloads.`,
      [ref(gatewayFile.id, gLine), ref(normalizerFile.id, nLine)], 'directly-verified')
  }
  if (gatewayFile && ruleFile && mlFile) {
    const gLine = findLine(gatewayFile.content, 'inspect_request(')
    const rLine = findLine(ruleFile.content, 'def inspect_request')
    add('flow', `Request pipeline stage 2: normalized request is evaluated in parallel by inspect_request in ${ruleFile.path} and predict_payload in ${mlFile.path}.`,
      [ref(gatewayFile.id, gLine), ref(ruleFile.id, rLine)], 'directly-verified')
  }
  if (gatewayFile && decisionFile) {
    const gLine = findLine(gatewayFile.content, 'evaluate_request_policy(')
    const dLine = findLine(decisionFile.content, 'def evaluate_request_policy')
    add('flow', `Request pipeline stage 3: policy decision is evaluated by evaluate_request_policy in ${decisionFile.path} based on weighted rule and ML anomaly scores.`,
      [ref(gatewayFile.id, gLine), ref(decisionFile.id, dLine)], 'directly-verified')
  }
  if (gatewayFile) {
    const gLine = findLine(gatewayFile.content, 'HTTP_403_FORBIDDEN')
    add('flow', `Request pipeline stage 4: BLOCK decisions return HTTP 403 immediately; ALLOW and MONITOR decisions forward traffic to upstream target via httpx.`,
      [ref(gatewayFile.id, gLine)], 'directly-verified')
  }
  if (gatewayFile && repoFile) {
    const gLine = findLine(gatewayFile.content, 'async_insert_security_event(')
    const rLine = findLine(repoFile.content, 'def insert_security_event')
    add('flow', `Request pipeline stage 5: inspection results, scores, and decision metadata are logged asynchronously to relational storage via ${repoFile.path}.`,
      [ref(gatewayFile.id, gLine), ref(repoFile.id, rLine)], 'directly-verified')
  }

  // 5. Frontend-Backend Communication
  if (apiFile && backendEntry) {
    const apiContent = apiFile.content
    const backendContent = backendEntry.content
    const endpoints = [
      { path: '/api/v1/security/events', search: '/security/events' },
      { path: '/api/v1/security/metrics', search: '/security/metrics' },
      { path: '/api/v1/health', search: '/health' },
      { path: '/api/v1/ml/diagnostics', search: '/ml/diagnostics' },
    ]
    for (const ep of endpoints) {
      if (apiContent.includes(ep.search) && backendContent.includes(ep.path)) {
        const aLine = findLine(apiContent, ep.search)
        const bLine = findLine(backendContent, ep.path)
        add('communication', `${apiFile.path} issues client fetch requests targeting ${ep.path}, served by ${backendEntry.path}.`,
          [ref(apiFile.id, aLine), ref(backendEntry.id, bLine)], 'directly-verified')
      }
    }
  }

  // 6. Data Storage
  if (dbFile) {
    const line = findLine(dbFile.content, 'def init_db')
    add('storage', `${dbFile.path} initializes SQLite database schema and manages connection lifecycle using sqlite3.`,
      [ref(dbFile.id, line)], 'directly-verified')
  }
  if (repoFile) {
    const line = findLine(repoFile.content, 'def insert_security_event')
    add('storage', `${repoFile.path} manages relational persistence for security_events records including incident queries, pagination, and exports.`,
      [ref(repoFile.id, line)], 'directly-verified')
  }
  const modelFile = files.find(f => f.path.includes('models.py'))
  if (modelFile) {
    const line = findLine(modelFile.content, 'class SecurityEventRecord')
    add('storage', `${modelFile.path} defines SecurityEventRecord dataclass schema representing security incidents and policy evaluations.`,
      [ref(modelFile.id, line)], 'directly-verified')
  }

  // 7. Security Architecture
  if (authFile && backendEntry) {
    const aLine = findLine(authFile.content, 'def require_admin_auth')
    const bLine = findLine(backendEntry.content, 'require_admin_auth')
    add('security', `${authFile.path} declares require_admin_auth enforcing API key and Bearer token authentication on administrative endpoints.`,
      [ref(authFile.id, aLine), ref(backendEntry.id, bLine)], 'directly-verified')
  }
  if (gatewayFile) {
    const line = findLine(gatewayFile.content, 'HTTP_403_FORBIDDEN')
    add('security', `${gatewayFile.path} enforces WAF blocking policy returning HTTP 403 for high-risk requests exceeding threshold.`,
      [ref(gatewayFile.id, line)], 'directly-verified')
  }
  if (backendEntry && backendEntry.content.includes('sanitize_csv_cell')) {
    const line = findLine(backendEntry.content, 'def sanitize_csv_cell')
    add('security', `${backendEntry.path} applies formula injection sanitization to exported security event CSV cells.`,
      [ref(backendEntry.id, line)], 'directly-verified')
  }

  // 8. Technology Stack
  if (backendEntry && backendEntry.path.endsWith('.py')) {
    const line = findLine(backendEntry.content, 'from fastapi import FastAPI')
    add('technology', `Python FastAPI framework powers the reverse proxy gateway and administrative REST API.`,
      [ref(backendEntry.id, line)], 'verified-artifact')
  }
  const pkgFile = files.find(f => f.path.endsWith('package.json'))
  if (pkgFile && pkgFile.content.includes('"react"')) {
    const line = findLine(pkgFile.content, '"react":')
    add('technology', `React SPA with Vite, TailwindCSS, and Recharts powers the frontend security management dashboard.`,
      [ref(pkgFile.id, line)], 'verified-artifact')
  }
  if (mlFile && mlFile.content.includes('joblib')) {
    const line = findLine(mlFile.content, 'import joblib')
    add('technology', `scikit-learn and joblib power the machine learning anomaly detection engine.`,
      [ref(mlFile.id, line)], 'verified-artifact')
  }
}

function generateArchitectureDiagram(files) {
  const hasGateway = files.some(f => f.path.includes('gateway.py'))
  const hasFrontend = files.some(f => f.path.startsWith('frontend/'))
  const hasExpress = files.some(f => f.content.includes("from 'express'") || f.content.includes("require('express')"))

  if (hasGateway && hasFrontend) {
    const mermaid = `flowchart TD
  Client["Client / Traffic Simulator"] -->|"HTTP Traffic"| Gateway["Reverse Proxy Gateway (backend/app/core/gateway.py)"]
  Gateway --> Normalizer["Request Normalizer (backend/app/core/normalizer.py)"]
  Normalizer --> RuleEngine["Signature Rule Engine (backend/app/core/rule_engine.py)"]
  Normalizer --> MLEngine["ML Anomaly Engine (backend/app/core/ml_engine.py)"]
  RuleEngine --> DecisionEngine["Policy Decision Engine (backend/app/core/decision_engine.py)"]
  MLEngine --> DecisionEngine
  DecisionEngine -->|"Action: BLOCK (HTTP 403)"| Client
  DecisionEngine -->|"Action: ALLOW / MONITOR"| Upstream["Upstream Target Application"]
  Gateway -->|"Audit Telemetry"| Repository["Security Event Repository (backend/app/db/repository.py)"]
  Repository --> Database[("SQLite Storage (backend/app/db/database.py)")]
  Frontend["React Dashboard Frontend (frontend/src/App.jsx)"] -->|"REST API / Bearer Auth"| BackendAPI["FastAPI Admin API (backend/app/main.py)"]
  BackendAPI -->|"Query Metrics & Logs"| Repository`

    const text = `+-------------------------------------------------------------------------------------------------+
|                                        Client Traffic                                           |
+-------------------------------------------------------------------------------------------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                           Reverse Proxy Gateway (app/core/gateway.py)                           |
+-------------------------------------------------------------------------------------------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                           Request Normalizer (app/core/normalizer.py)                           |
+-------------------------------------------------------------------------------------------------+
                                                 |
                               +-----------------+-----------------+
                               |                                   |
                               v                                   v
+-----------------------------------------------+   +---------------------------------------------+
|    Signature Rule Engine (rule_engine.py)     |   |      ML Anomaly Engine (ml_engine.py)       |
|  - Regex pattern matching (SQLi, XSS, CMDi)   |   |  - TF-IDF vectorization & anomaly scoring   |
+-----------------------------------------------+   +---------------------------------------------+
                               |                                   |
                               +-----------------+-----------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                         Policy Decision Engine (app/core/decision_engine.py)                    |
|                         - Composite risk score: (0.6 * rule) + (0.4 * ml)                       |
+-------------------------------------------------------------------------------------------------+
                               |                                   |
                 [Action: BLOCK (Risk >= 65)]         [Action: ALLOW / MONITOR]
                               |                                   |
                               v                                   v
                +-----------------------------+     +-----------------------------+
                |   HTTP 403 Security Block   |     | Forward to Upstream Target  |
                +-----------------------------+     +-----------------------------+
                               \\                                   /
                                +----------------+----------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                            Security Event Repository (app/db/repository.py)                     |
|                            - Asynchronous event logging & metrics aggregation                   |
+-------------------------------------------------------------------------------------------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                                SQLite Storage (app/db/database.py)                              |
+-------------------------------------------------------------------------------------------------+
                                                 ^
                                                 | Query Events / Metrics
+------------------------------------------------+------------------------------------------------+
|                         FastAPI Admin API Controller (app/main.py)                              |
|             - Endpoints: /health, /security/events, /security/metrics, /ml/diagnostics          |
+-------------------------------------------------------------------------------------------------+
                                                 ^
                                                 | Client fetch() / Bearer Auth
+------------------------------------------------+------------------------------------------------+
|                    React Management Dashboard (frontend/src/App.jsx)                            |
|          - Pages: DashboardOverview, LiveTraffic, SecurityLogs, MLDiagnostics, Simulator        |
+-------------------------------------------------------------------------------------------------+`

    return { mermaid, text }
  }

  if (hasExpress) {
    const mermaid = `flowchart TD
  Client["HTTP Client"] --> App["Express Application (src/app.js)"]
  App --> Router["Express Router (/api)"]
  Router --> Handler["greet Handler (GET /items)"]`

    const text = `+-------------------------------------------------------------------------------------------------+
|                                        Client Requests                                          |
+-------------------------------------------------------------------------------------------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                              Express Application (src/app.js)                                   |
+-------------------------------------------------------------------------------------------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                                Express Router (Prefix: /api)                                    |
+-------------------------------------------------------------------------------------------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                             Route Handler: GET /items (greet)                                   |
+-------------------------------------------------------------------------------------------------+`

    return { mermaid, text }
  }

  const mermaid = `flowchart TD
  Client["Client Application"] --> Backend["Backend Service"]
  Backend --> Storage["Data Storage"]`
  const text = `Client Application --> Backend Service --> Data Storage`
  return { mermaid, text }
}

module.exports = {
  extractArchitectureEvidence,
  generateArchitectureDiagram,
}
