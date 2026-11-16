#!/usr/bin/env node
// Static + runtime security audit. Fails (exit 1) on any HIGH finding.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const findings = []
function add(severity, id, detail) {
  findings.push({ severity, id, detail })
}

function read(p) {
  try {
    return fs.readFileSync(path.join(root, p), 'utf8')
  } catch {
    return ''
  }
}

// 1. Required hardening modules
const appJs = read('src/app.js')
if (!appJs.includes('helmet()')) add('HIGH', 'missing-helmet', 'helmet() not wired in src/app.js')
if (!appJs.includes('express-rate-limit') && !appJs.includes('rateLimit')) add('HIGH', 'missing-rate-limit', 'rate limiting missing')
if (!appJs.includes('cors(')) add('MEDIUM', 'missing-cors', 'cors() not configured')
if (appJs.includes("origin: '*'") || appJs.includes('origin: true')) add('HIGH', 'cors-wildcard', 'CORS wildcard allows any origin')
if (!appJs.includes("limit: '100kb'") && !appJs.includes('limit:"100kb"')) add('MEDIUM', 'body-limit', 'JSON body limit not set (DoS risk)')
if (!appJs.includes("disable('x-powered-by')") && !appJs.includes('disable("x-powered-by")')) add('LOW', 'powered-by', 'x-powered-by not disabled')

// 2. Auth checks
const authMw = read('src/middleware/auth.js')
if (!authMw.includes('jwt.verify')) add('HIGH', 'jwt-verify', 'JWT verification missing')
if (!authMw.includes('Bearer')) add('MEDIUM', 'bearer-scheme', 'Bearer scheme not enforced')
const authRoute = read('src/routes/auth.js')
if (!authRoute.includes('bcrypt')) add('HIGH', 'plaintext-password', 'bcrypt password hashing missing')
if (!authRoute.includes('normalizeEmail') && !authRoute.includes('isEmail')) add('MEDIUM', 'input-validation', 'express-validator email checks missing')
const indexJs = read('src/index.js')
if (indexJs.includes('JWT_SECRET') && indexJs.includes('process.exit(1)')) {
  // good: hard fail without secret
} else {
  add('HIGH', 'jwt-secret-boot', 'Server must refuse to boot without JWT_SECRET')
}
const secret = process.env.JWT_SECRET || ''
if (!secret) add('HIGH', 'jwt-secret-missing', 'JWT_SECRET env is empty (server refuses to boot in prod)')
else if (secret.length < 32) add('HIGH', 'jwt-secret-weak', 'JWT_SECRET must be >= 32 chars')

// 3. Error handling — no stack leaks
const httpMw = read('src/middleware/http.js')
if (!httpMw.includes('Internal server error')) add('MEDIUM', 'error-leak', 'Generic 500 handler missing')

// 4. npm audit (production deps, JSON)
try {
  const out = execSync('npm audit --omit=dev --json', { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  const audit = JSON.parse(out)
  const counts = (audit.metadata && audit.metadata.vulnerabilities) || {}
  for (const sev of ['critical', 'high']) {
    if ((counts[sev] || 0) > 0) add('HIGH', `npm-${sev}`, `npm audit: ${counts[sev]} ${sev} vulns in prod deps`)
  }
  if ((counts.moderate || 0) > 0) add('MEDIUM', 'npm-moderate', `npm audit: ${counts.moderate} moderate vulns`)
} catch (err) {
  // npm audit exits non-zero when vulns found — parse stdout anyway.
  try {
    const audit = JSON.parse((err.stdout || '').toString())
    const counts = (audit.metadata && audit.metadata.vulnerabilities) || {}
    if ((counts.critical || 0) > 0) add('HIGH', 'npm-critical', `npm audit: ${counts.critical} critical vulns`)
    if ((counts.high || 0) > 0) add('HIGH', 'npm-high', `npm audit: ${counts.high} high vulns`)
    if ((counts.moderate || 0) > 0) add('MEDIUM', 'npm-moderate', `npm audit: ${counts.moderate} moderate vulns`)
  } catch {
    add('MEDIUM', 'npm-audit-error', 'npm audit could not be parsed')
  }
}

// Report
const high = findings.filter((f) => f.severity === 'HIGH')
console.log(JSON.stringify({ passed: high.length === 0, findings }, null, 2))
process.exit(high.length === 0 ? 0 : 1)
