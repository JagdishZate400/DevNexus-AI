require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const registry = require('../src/services/documentTypes')
const validation = require('../src/services/documentValidation')
const { extractEvidence, LIMITS } = require('../src/services/documentEvidence')
function file(name, content) { return { id: crypto.randomUUID(), path: name, content, sha256: crypto.createHash('sha256').update(content).digest('hex') } }
test('registry has nine immutable canonical types and backend generation capability with Overview-only frontend', () => {
  assert.deepEqual(registry.CANONICAL_IDS, ['readme','project-overview','installation-guide','architecture','project-structure','module-documentation','api-documentation','developer-notes','technology-stack'])
  assert.equal(new Set(registry.STORAGE_IDS).size, 11)
  for (const type of registry.DOCUMENT_TYPES) {
    assert.ok(type.displayName && type.evidenceRequirements.length)
    assert.ok(Object.isFrozen(type) && Object.isFrozen(type.evidenceRequirements))
    assert.equal(registry.generationSupported(type.id), true)
    assert.equal(type.frontendEnabled, type.id === 'project-overview')
    assert.equal(validation.generationRequest({projectId:'p',documentType:type.id}).documentType,type.id)
  }
})
test('legacy interpretation never rewrites stored IDs; invalid/prototype keys rejected', () => {
  for (const [legacy, canonical] of Object.entries(registry.LEGACY_TYPES)) {
    assert.equal(registry.canonicalType(legacy), canonical)
    assert.equal(validation.draft({ projectId: 'p', documentType: legacy, title: 'Historical' }).documentType, legacy)
  }
  for (const value of ['__proto__','constructor','unknown',null,{}]) assert.equal(registry.canonicalType(value), null)
  assert.deepEqual(validation.TYPES, registry.STORAGE_IDS)
})
test('migration accepts canonical and legacy IDs without DML or modifying original migration', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../scripts/migrations/0156-documentation-types.sql'), 'utf8')
  for (const id of registry.STORAGE_IDS) assert.ok(sql.includes(`'${id}'`))
  assert.match(sql, /ADD CONSTRAINT[\s\S]+NOT VALID;[\s\S]+VALIDATE CONSTRAINT[\s\S]+DROP CONSTRAINT/)
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\s/i)
  assert.match(sql, /lock_timeout/)
})
test('extracts bounded source facts and folder paths with source identity', () => {
  const f = file('Src/routes.js', "import express from 'express'; const app=express();\nconst router = express.Router();\nexport function handler(req,res) {}\nrouter.get('/items', handler);\napp.use('/api', router);\nmodule.exports = router;")
  const result = extractEvidence([f]), facts = result.files[0]
  assert.deepEqual(result.structure.folders, ['Src'])
  assert.equal(facts.imports[0].specifier, 'express')
  assert.ok(facts.symbols.some(s => s.name === 'handler' && s.kind === 'function'))
  assert.ok(facts.exports.some(s => s.name === 'handler' && s.kind === 'function'))
  assert.equal(facts.routes[0].method, 'GET'); assert.equal(facts.routes[0].reference.lineStart, 4)
  assert.equal(facts.mounts[0].target, 'router')
  assert.equal(facts.reference.hash, f.sha256)
  assert.equal(result.promptReady, false)
})
test('comments, strings, templates and dynamic routes cannot supply static routes', () => {
  const result = extractEvidence([file('app.ts', '// app.get("/fake", h)\nconst s = "app.post(\'/fake\', h)";\n/* app.put("/fake", h) */\napp.get(`/dynamic/${id}`, h);\napp.get(path, h);')])
  assert.deepEqual(result.files[0].routes, [])
})
test('manifest extracts declared ranges and only allowlisted script commands without private URLs', () => {
  const result = extractEvidence([file('package.json', JSON.stringify({ dependencies: { express: '^4.0.0', internal: 'https://private.example/pkg' }, scripts: { start: 'node app.js' }, engines: { node: '>=20' } }))])
  const facts = result.files[0]
  assert.deepEqual(facts.dependencies.map(d => d.name), ['express'])
  assert.deepEqual(facts.scripts, [{ name: 'start', commandWithheld: false, declaredCommand: 'node app.js' }])
  assert.equal(facts.engines[0].declaredRange, '>=20')
  assert.equal(facts.scripts[0].declaredCommand, 'node app.js')
})
test('setup text is withheld; only empty configuration declarations are accepted', () => {
  const r = extractEvidence([file('README.md', '# Setup\nDo not run arbitrary commands.'), file('.env.example', '# Example\nPORT=\nDATABASE_URL=\n')])
  assert.equal(r.files[0].contentWithheld, true)
  assert.deepEqual(r.files[1].keys, ['PORT','DATABASE_URL'])
  assert.ok(!JSON.stringify(r).includes('Do not run'))
  assert.throws(() => extractEvidence([file('.env.example', 'PORT=5000')]), { code: 'configuration_value_rejected' })
})
test('actual environments, traversal, private keys and credential content are rejected', () => {
  for (const name of ['.env','.env.local','dir/.env','id_rsa','key.pem','../app.js','dir\\app.js','secrets/package.json']) assert.throws(() => extractEvidence([file(name, 'content')]))
  for (const content of ['const password = "not-a-real-password";', '-----BEGIN PRIVATE KEY-----', 'https://user:fakepass@example.com', 'Bearer abcdefghijk']) assert.throws(() => extractEvidence([file('README.md', content)]))
})
test('malformed manifests/source, integrity failures, duplicates and bounds fail closed', () => {
  for (const content of ['{','[]','{"dependencies":[]}','{"scripts":5}','{"engines":5}']) assert.throws(() => extractEvidence([file('package.json', content)]))
  assert.throws(() => extractEvidence([file('a.js', '/* unterminated')]), { code: 'malformed_source' })
  const f = file('a.js', 'export const a=1;')
  assert.throws(() => extractEvidence([{ ...f, content: 'changed' }]), { code: 'source_integrity' })
  assert.throws(() => extractEvidence([f, { ...f, id: crypto.randomUUID(), path: 'A.js' }]), { code: 'duplicate_file' })
  assert.throws(() => extractEvidence([file('a.js', ' '.repeat(LIMITS.fileBytes + 1))]), { code: 'context_limit' })
  assert.throws(() => extractEvidence(Array(LIMITS.files + 1).fill(f)), { code: 'file_limit' })
  assert.throws(() => extractEvidence([file('a.js', '\ud800')]), { code: 'invalid_text' })
  assert.throws(() => extractEvidence([f, file('a.js/b.js', '')]), { code: 'path_conflict' })
})
