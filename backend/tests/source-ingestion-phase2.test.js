require('./helpers/offline')
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')
const request = require('supertest')
const { Pool } = require('pg')
const zlib = require('zlib')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const {
  extractSource,
  validatePath,
  LIMITS,
  SUPPORTED_LANGUAGES,
  LANGUAGE_EXTENSIONS,
  resolveLanguage,
  shouldSkipEntry,
  crc32,
} = require('../src/services/sourceArchive')
const { chunkFile } = require('../src/services/sourceChunks')
const { makeZip } = require('./helpers/sourceZip')
const { createSourceRepository } = require('../src/db/sourceRepository')

const users = createTestRepository()
const owner = { id: crypto.randomUUID(), email: 'phase2-owner@example.com', role: 'Developer' }
const token = signToken(owner)

const stored = new Map()
const memoryRepository = {
  async listProjects(id) { return [...stored.values()].filter((p) => p.ownerId === id).map(({ id, name }) => ({ id, name })) },
  async findProject(id, ownerId) { const p = stored.get(id); return p?.ownerId === ownerId ? { id, name: p.name } : null },
  async listFiles(id, ownerId) { return (stored.get(id)?.ownerId === ownerId ? stored.get(id).files : []).map(({ content, ...f }) => f) },
  async readFile(id, fileId, ownerId) { return stored.get(id)?.ownerId === ownerId ? stored.get(id).files.find((f) => f.id === fileId) : null },
  async addFiles(project, ownerId, files) {
    const p = stored.get(project.id) || { ...project, ownerId, files: [] }
    p.files.push(...files.map((f) => ({ ...f, id: crypto.randomUUID(), uploadedAt: new Date().toISOString() })))
    stored.set(project.id, p)
  },
  async removeProject(id) { stored.delete(id) },
}

let app, testProjectId

before(async () => {
  await users.createUser(owner)
  app = createApp({ userRepository: users, sourceRepository: memoryRepository })
  const res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Phase 2 Test Project', description: 'Multi-Language Test' })
  testProjectId = res.body.project.id
})

test('Test 1: Ingestion and chunking of all 15 languages in a single archive', async () => {
  const languageSamples = [
    { path: 'src/index.js', language: 'JavaScript', content: 'console.log("Hello JS");\nfunction run() { return true; }' },
    { path: 'src/types.ts', language: 'TypeScript', content: 'export interface Config {\n  port: number;\n  host: string;\n}' },
    { path: 'src/main.py', language: 'Python', content: 'def calculate(a, b):\n    return a + b\n\nif __name__ == "__main__":\n    print(calculate(1, 2))' },
    { path: 'src/Main.java', language: 'Java', content: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Java");\n  }\n}' },
    { path: 'src/lib.c', language: 'C', content: '#include <stdio.h>\nint add(int a, int b) {\n  return a + b;\n}' },
    { path: 'src/app.cpp', language: 'C++', content: '#include <iostream>\nint main() {\n  std::cout << "C++" << std::endl;\n  return 0;\n}' },
    { path: 'src/Program.cs', language: 'C#', content: 'using System;\nnamespace App {\n  class Program {\n    static void Main() {}\n  }\n}' },
    { path: 'src/server.go', language: 'Go', content: 'package main\nimport "fmt"\nfunc main() {\n  fmt.Println("Go")\n}' },
    { path: 'src/core.rs', language: 'Rust', content: 'pub fn multiply(a: i32, b: i32) -> i32 {\n  a * b\n}' },
    { path: 'src/api.php', language: 'PHP', content: '<?php\nfunction respond($data) {\n  return json_encode($data);\n}' },
    { path: 'src/index.html', language: 'HTML', content: '<!DOCTYPE html>\n<html>\n<head><title>Test</title></head>\n<body><h1>DevNexus</h1></body>\n</html>' },
    { path: 'src/style.css', language: 'CSS', content: 'body {\n  font-family: sans-serif;\n  color: #111;\n  background: #fff;\n}' },
    { path: 'src/config.json', language: 'JSON', content: '{\n  "name": "devnexus",\n  "version": "2.0.0"\n}' },
    { path: 'src/deploy.yaml', language: 'YAML', content: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: devnexus-app' },
    { path: 'src/schema.sql', language: 'SQL', content: 'CREATE TABLE IF NOT EXISTS metrics (\n  id UUID PRIMARY KEY,\n  count INT NOT NULL\n);' },
  ]

  assert.equal(languageSamples.length, 15)
  assert.equal(SUPPORTED_LANGUAGES.length, 15)

  for (const sample of languageSamples) {
    assert.equal(resolveLanguage(sample.path), sample.language)
  }

  const zip = makeZip(languageSamples.map((s) => ({ path: s.path, content: s.content })))
  const files = await extractSource(zip)

  assert.equal(files.length, 15)
  for (const sample of languageSamples) {
    const extracted = files.find((f) => f.path === sample.path)
    assert.ok(extracted, `File ${sample.path} must be extracted`)
    assert.equal(extracted.language, sample.language)
    assert.equal(extracted.content, sample.content)
    assert.equal(extracted.byteSize, Buffer.byteLength(sample.content))

    const chunks = chunkFile(extracted)
    assert.ok(Array.isArray(chunks))
    assert.ok(chunks.length > 0, `File ${sample.path} must generate at least 1 chunk`)
    assert.equal(chunks[0].ordinal, 0)
    assert.ok(chunks[0].content.length > 0)
  }
})

test('Test 2: Skip dependency folders, build outputs, and benign non-source without rejecting valid files', async () => {
  const entries = [
    { path: 'src/app.js', content: 'export const app = () => {};' },
    { path: 'src/utils.py', content: 'def helper(): pass' },
    { path: 'src/query.sql', content: 'SELECT * FROM users;' },

    { path: 'node_modules/express/index.js', content: 'module.exports = {};' },
    { path: 'vendor/composer/autoload.php', content: '<?php // autoload' },
    { path: '.git/HEAD', content: 'ref: refs/heads/main' },
    { path: '.git/config', content: '[core]' },
    { path: '.venv/bin/activate', content: '#!/bin/sh' },
    { path: 'venv/lib/site-packages/pkg.py', content: '# package' },
    { path: 'dist/bundle.js', content: 'var bundled = true;' },
    { path: 'build/App.class', content: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) },
    { path: 'target/release/lib.rs', content: '// build artifact' },
    { path: '.next/cache/build.js', content: 'var cache = 1;' },
    { path: '.idea/workspace.xml', content: '<project />' },
    { path: '.vscode/settings.json', content: '{"editor.tabSize": 2}' },
    { path: '__pycache__/app.cpython-311.pyc', content: Buffer.from([0x00, 0x01, 0x02]) },
    { path: 'README.md', content: '# Project Title' },
    { path: 'docs/guide.markdown', content: '# Guide' },
    { path: 'assets/logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    { path: 'docs/manual.pdf', content: Buffer.from('%PDF-1.4') },
    { path: 'bin/tool.exe', content: Buffer.from('MZ') },
    { path: 'yarn.lock', content: '# lockfile' },
  ]

  const zip = makeZip(entries)
  const files = await extractSource(zip)

  assert.equal(files.length, 3)
  const paths = files.map((f) => f.path).sort()
  assert.deepEqual(paths, ['src/app.js', 'src/query.sql', 'src/utils.py'])
})

test('Test 3: Reject dangerous archive paths, traversals, and symlinks with 400', async () => {
  const dangerous = [
    { path: '../bad.js' },
    { path: 'src/../../etc/passwd' },
    { path: '/root/bad.py' },
    { path: 'C:\\Windows\\system32\\bad.js' },
    { path: 'aux.py' },
    { path: 'com1.js' },
    { path: 'link.js', mode: 0xa1ff },
    { path: 'encrypted.js', encrypted: true },
    { path: 'dir/', mode: 0x41ed, content: 'not empty' },
  ]

  for (const entry of dangerous) {
    const zip = makeZip([{ path: 'src/valid.js', content: 'safe' }, entry])
    await assert.rejects(
      extractSource(zip),
      (err) => err.status === 400,
      `Entry ${entry.path} must be rejected with status 400`
    )
  }
})

test('Test 4: Reject sensitive files and detected secrets with 400', async () => {
  const secretFiles = [
    { path: '.env' },
    { path: 'config/.env.local' },
    { path: 'env/.env.production' },
    { path: 'id_rsa' },
    { path: 'id_ed25519' },
    { path: 'credentials' },
    { path: 'certs/server.key' },
    { path: 'certs/root.pem' },
    { path: 'certs/cert.p12' },
  ]

  for (const entry of secretFiles) {
    const zip = makeZip([{ path: 'src/valid.js', content: 'safe' }, entry])
    await assert.rejects(
      extractSource(zip),
      (err) => err.status === 400 && err.code === 'sensitive_file',
      `File ${entry.path} must be rejected with sensitive_file`
    )
  }

  const secretContents = [
    '-----BEGIN RSA PRIVATE KEY-----',
    '-----BEGIN EC PRIVATE KEY-----',
    'const awsKey = "AKIA1234567890123456";',
    'const token = "ghp_123456789012345678901234567890123456";',
    'const openai = "sk-proj-12345678901234567890123456789012";',
    'const apiKey = "super-secret-password-assignment-123456";',
  ]

  for (const content of secretContents) {
    const zip = makeZip([{ path: 'src/app.js', content }])
    await assert.rejects(
      extractSource(zip),
      (err) => err.status === 400 && err.code === 'sensitive_content',
      `Content must be rejected with sensitive_content`
    )
  }
})

test('Test 5: Enforce independent limits for bombs, file size, lines, and archive size', async () => {
  // Archive size > 50 MiB
  await assert.rejects(
    extractSource(Buffer.alloc(LIMITS.archiveBytes + 1)),
    (err) => err.status === 413 && err.code === 'archive_limit'
  )

  // Single file > 1 MiB
  await assert.rejects(
    extractSource(makeZip([{ path: 'large.js', content: 'x'.repeat(LIMITS.fileBytes + 1), deflate: true }])),
    (err) => err.status === 413 && err.code === 'source_limit'
  )

  // Lines > 25,000
  await assert.rejects(
    extractSource(makeZip([{ path: 'lines.js', content: '\n'.repeat(LIMITS.lines) }])),
    (err) => err.status === 413 && err.code === 'source_limit'
  )

  // Decompression bomb: 500 KB uncompressed compressing >25:1
  const bombContent = 'A'.repeat(500 * 1024)
  const bombZip = makeZip([{ path: 'bomb.js', content: bombContent, deflate: true }])
  await assert.rejects(
    extractSource(bombZip),
    (err) => err.status === 413 && (err.code === 'decompression_bomb' || err.code === 'source_limit')
  )
})

test('Test 6: Streaming upload creates and securely unlinks temporary files on success, failure, and overflow', async () => {
  const getTempUploadFiles = () => {
    return fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('devnexus-upload-') && f.endsWith('.zip'))
  }

  const initialTemps = getTempUploadFiles()

  // 1. Success case
  const validZip = makeZip([
    { path: 'src/app.py', content: 'print("Streaming works")' },
    { path: 'src/app.js', content: 'console.log("Streaming works");' },
  ])
  const resSuccess = await request(app)
    .post(`/api/workspace/projects/${testProjectId}/upload`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/zip')
    .send(validZip)

  assert.equal(resSuccess.status, 201)
  assert.equal(resSuccess.body.uploadedFiles, 2)
  const afterSuccessTemps = getTempUploadFiles()
  assert.equal(afterSuccessTemps.length, initialTemps.length, 'Temp file must be deleted on success')

  // 2. Failure case (sensitive file in archive)
  const invalidZip = makeZip([
    { path: 'src/app.js', content: 'console.log("ok");' },
    { path: '.env', content: 'SECRET=true' },
  ])
  const resFail = await request(app)
    .post(`/api/workspace/projects/${testProjectId}/upload`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/zip')
    .send(invalidZip)

  assert.equal(resFail.status, 400)
  assert.equal(resFail.body.code, 'sensitive_file')
  const afterFailTemps = getTempUploadFiles()
  assert.equal(afterFailTemps.length, initialTemps.length, 'Temp file must be deleted on failure')

  // 3. Overflow case (> 50 MiB)
  const resOverflow = await request(app)
    .post(`/api/workspace/projects/${testProjectId}/upload`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/zip')
    .send(Buffer.alloc(LIMITS.archiveBytes + 1))

  assert.equal(resOverflow.status, 413)
  assert.equal(resOverflow.body.code, 'archive_limit')
  const afterOverflowTemps = getTempUploadFiles()
  assert.equal(afterOverflowTemps.length, initialTemps.length, 'Temp file must be deleted on overflow')
})

test('Test 7: PostgreSQL integration and record preservation in disposable database', async (t) => {
  require('dotenv').config({ path: path.join(__dirname, '../.env') })
  if (!process.env.DATABASE_URL) { t.skip('Requires an explicitly verified disposable database'); return }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()

  try {
    // 1. Verify baseline record integrity
    const baseline = (await client.query(`
      SELECT
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM source_projects) AS projects,
        (SELECT count(*) FROM source_files) AS files,
        (SELECT count(*) FROM source_file_indexes) AS indexes,
        (SELECT count(*) FROM source_chunks) AS chunks,
        (SELECT count(*) FROM repository_reviews) AS reviews,
        (SELECT count(*) FROM repository_review_batches) AS batches,
        (SELECT count(*) FROM repository_review_batch_files) AS batch_files,
        (SELECT count(*) FROM tasks) AS tasks,
        (SELECT count(*) FROM sprints) AS sprints,
        (SELECT count(*) FROM project_memberships) AS memberships
    `)).rows[0]

    assert.equal(Number(baseline.users), 5, 'Baseline users count must remain 5')
    assert.equal(Number(baseline.projects), 9, 'Baseline source_projects count must remain 9')
    assert.equal(Number(baseline.files), 20, 'Baseline source_files count must remain 20')
    assert.equal(Number(baseline.indexes), 20, 'Baseline source_file_indexes count must remain 20')
    assert.equal(Number(baseline.chunks), 20, 'Baseline source_chunks count must remain 20')
    assert.equal(Number(baseline.reviews), 59, 'Baseline repository_reviews count must remain 59')
    assert.equal(Number(baseline.batches), 18, 'Baseline batches count must remain 18')
    assert.equal(Number(baseline.batch_files), 36, 'Baseline batch_files count must remain 36')
    assert.equal(Number(baseline.tasks), 2, 'Baseline tasks count must remain 2')
    assert.equal(Number(baseline.sprints), 2, 'Baseline sprints count must remain 2')
    assert.equal(Number(baseline.memberships), 3, 'Baseline memberships count must remain 3')

    // 2. Insert and index a multi-language project in PostgreSQL
    const repo = createSourceRepository(pool)
    const testOwnerId = (await client.query('SELECT id FROM users LIMIT 1')).rows[0].id
    const isolatedProjectId = `phase2-pg-test-${crypto.randomBytes(4).toString('hex')}`
    const isolatedProject = { id: isolatedProjectId, name: 'Phase 2 PG Integration Test' }

    const multiFiles = [
      { path: 'src/main.py', language: 'Python', content: 'def test(): return "python"', byteSize: 28, sha256: crypto.createHash('sha256').update('def test(): return "python"').digest('hex') },
      { path: 'src/lib.rs', language: 'Rust', content: 'pub fn test() -> i32 { 42 }', byteSize: 28, sha256: crypto.createHash('sha256').update('pub fn test() -> i32 { 42 }').digest('hex') },
      { path: 'src/query.sql', language: 'SQL', content: 'SELECT 1;', byteSize: 9, sha256: crypto.createHash('sha256').update('SELECT 1;').digest('hex') },
      { path: 'src/config.json', language: 'JSON', content: '{"ok": true}', byteSize: 12, sha256: crypto.createHash('sha256').update('{"ok": true}').digest('hex') },
    ]

    await repo.addFiles(isolatedProject, testOwnerId, multiFiles)

    // 3. Verify files and indexes in PostgreSQL
    const storedFiles = await repo.listFiles(isolatedProjectId, testOwnerId)
    assert.equal(storedFiles.length, 4)
    for (const mf of multiFiles) {
      const sf = storedFiles.find((f) => f.path === mf.path)
      assert.ok(sf, `Stored file ${mf.path} must exist`)
      assert.equal(sf.language, mf.language)
      assert.equal(sf.byteSize, mf.byteSize)
    }

    const indexStats = await repo.indexStats(isolatedProjectId, testOwnerId)
    assert.equal(indexStats.totalFiles, 4)
    assert.equal(indexStats.indexedFiles, 4)
    assert.equal(indexStats.excludedFiles, 0)
    assert.ok(indexStats.chunkCount >= 4)

    // 4. Search PostgreSQL chunks
    const searchResults = await repo.searchSource(isolatedProjectId, testOwnerId, 'python', 5)
    assert.ok(searchResults.length > 0)
    assert.equal(searchResults[0].path, 'src/main.py')

    // 5. Clean up isolated project
    await client.query('DELETE FROM source_chunks WHERE file_id IN (SELECT id FROM source_files WHERE project_id=$1)', [isolatedProjectId])
    await client.query('DELETE FROM source_file_indexes WHERE file_id IN (SELECT id FROM source_files WHERE project_id=$1)', [isolatedProjectId])
    await client.query('DELETE FROM source_files WHERE project_id=$1', [isolatedProjectId])
    await client.query('DELETE FROM source_projects WHERE id=$1', [isolatedProjectId])

    // 6. Confirm baseline remains unchanged
    const afterCount = (await client.query('SELECT count(*) FROM source_files')).rows[0].count
    assert.equal(Number(afterCount), 20, 'Source files count must remain exactly 20 after cleanup')
  } finally {
    client.release()
    await pool.end()
  }
})
