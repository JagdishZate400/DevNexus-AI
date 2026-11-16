const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
const config = require('../src/config')

const ALL_15_LANGUAGES = [
  { lang: 'JavaScript', file: 'src/app.js', content: 'console.log("hello");' },
  { lang: 'TypeScript', file: 'src/types.ts', content: 'export type ID = string;' },
  { lang: 'Python', file: 'scripts/service.py', content: 'def run():\n    print("service")' },
  { lang: 'Java', file: 'src/main/App.java', content: 'public class App {}' },
  { lang: 'C', file: 'src/native.c', content: 'int main() { return 0; }' },
  { lang: 'C++', file: 'src/engine.cpp', content: 'class Engine {};' },
  { lang: 'C#', file: 'src/Program.cs', content: 'namespace App { class Program {} }' },
  { lang: 'Go', file: 'cmd/server/main.go', content: 'package main\nfunc main() {}' },
  { lang: 'Rust', file: 'src/lib.rs', content: 'pub fn init() {}' },
  { lang: 'PHP', file: 'public/index.php', content: '<?php echo "ok"; ?>' },
  { lang: 'HTML', file: 'public/index.html', content: '<!DOCTYPE html><html></html>' },
  { lang: 'CSS', file: 'styles/main.css', content: 'body { margin: 0; }' },
  { lang: 'JSON', file: 'config/settings.json', content: '{"active": true}' },
  { lang: 'YAML', file: 'deploy/stack.yaml', content: 'version: "3.8"' },
  { lang: 'SQL', file: 'migrations/init.sql', content: 'SELECT 1;' },
]

test('isolated PostgreSQL multi-language source migration (0159), 15 languages, 1 MiB byte size, and rollback compatibility', async (t) => {
  if (!config.databaseUrl) {
    t.skip('DATABASE_URL not configured for integration test')
    return
  }

  const schema = `source_lang_test_${crypto.randomBytes(6).toString('hex')}`
  const admin = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
  })

  let pool = null

  try {
    // 1. Create isolated temporary schema
    await admin.query(`CREATE SCHEMA ${schema}`)
    pool = new Pool({
      connectionString: config.databaseUrl,
      options: `-c search_path=${schema}`,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    })

    // 2. Setup baseline tables matching 0132, 0136, 0141, 0142
    await pool.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL
      );

      CREATE TABLE source_projects (
        id VARCHAR(160) PRIMARY KEY,
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(120) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE source_files (
        id UUID PRIMARY KEY,
        project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
        path VARCHAR(240) NOT NULL,
        language VARCHAR(20) NOT NULL CHECK (language IN ('JavaScript', 'TypeScript')),
        content TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 0 AND 524288),
        sha256 CHAR(64) NOT NULL,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (project_id, path),
        CHECK (octet_length(content) = byte_size)
      );

      CREATE TABLE source_file_indexes (
        file_id UUID PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
        source_sha256 CHAR(64) NOT NULL,
        index_version INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('indexed', 'excluded')),
        indexed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE source_chunks (
        id BIGSERIAL PRIMARY KEY,
        file_id UUID NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        start_line INTEGER NOT NULL CHECK (start_line > 0),
        end_line INTEGER NOT NULL CHECK (end_line >= start_line AND end_line - start_line < 80),
        start_column INTEGER NOT NULL CHECK (start_column > 0),
        end_column INTEGER NOT NULL CHECK (end_column > 0),
        content TEXT NOT NULL CHECK (octet_length(content) <= 8000),
        search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content)) STORED,
        UNIQUE(file_id, ordinal)
      );

      CREATE TABLE repository_reviews (
        id UUID PRIMARY KEY,
        project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
        file_id UUID NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
        source_sha256 CHAR(64) NOT NULL,
        file_path VARCHAR(240) NOT NULL,
        provider VARCHAR(20) NOT NULL CHECK (provider='gemini'),
        model VARCHAR(200) NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('In Progress','Completed','Failed')),
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        coverage JSONB NOT NULL,
        options JSONB NOT NULL,
        error_code VARCHAR(80)
      );

      CREATE TABLE repository_review_batches (
        id UUID PRIMARY KEY,
        project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        options JSONB NOT NULL,
        scope VARCHAR(20) NOT NULL CHECK (scope IN ('Selected Files','Entire Project')),
        provider VARCHAR(20) NOT NULL CHECK (provider='gemini'),
        model VARCHAR(200) NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('Queued','In Progress','Completed','Partial','Failed')),
        idempotency_key VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(owner_id, idempotency_key)
      );

      CREATE TABLE repository_review_batch_files (
        batch_id UUID NOT NULL REFERENCES repository_review_batches(id) ON DELETE CASCADE,
        file_id UUID NOT NULL,
        path VARCHAR(240) NOT NULL,
        source_sha256 CHAR(64) NOT NULL,
        byte_count INTEGER NOT NULL CHECK (byte_count >= 0 AND byte_count <= 524288),
        line_count INTEGER NOT NULL CHECK (line_count >= 0),
        ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 199),
        status VARCHAR(20) NOT NULL CHECK (status IN ('Pending','Running','Reviewed','Skipped','Failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(batch_id, file_id)
      );
    `)

    // 3. Seed baseline records
    const userId = crypto.randomUUID()
    const projectId = 'proj-seed-1'
    const jsFileId = crypto.randomUUID()
    const tsFileId = crypto.randomUUID()

    await pool.query('INSERT INTO users(id, email) VALUES ($1, $2)', [userId, 'dev@example.com'])
    await pool.query('INSERT INTO source_projects(id, owner_id, name) VALUES ($1, $2, $3)', [projectId, userId, 'Seed Project'])

    const jsContent = 'console.log("seed js");'
    const tsContent = 'export const x: number = 42;'
    await pool.query(`
      INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      jsFileId, projectId, 'src/app.js', 'JavaScript', jsContent, Buffer.byteLength(jsContent),
      crypto.createHash('sha256').update(jsContent).digest('hex')
    ])
    await pool.query(`
      INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      tsFileId, projectId, 'src/types.ts', 'TypeScript', tsContent, Buffer.byteLength(tsContent),
      crypto.createHash('sha256').update(tsContent).digest('hex')
    ])

    // Attach review and batch file to verify FKs
    const reviewId = crypto.randomUUID()
    const batchId = crypto.randomUUID()
    await pool.query(`
      INSERT INTO repository_reviews(id, project_id, file_id, source_sha256, file_path, provider, model, status, created_by, coverage, options)
      VALUES ($1, $2, $3, 'hash1', 'src/app.js', 'gemini', 'gemini-1.5', 'Completed', $4, '{}'::jsonb, '{}'::jsonb)
    `, [reviewId, projectId, jsFileId, userId])
    await pool.query(`
      INSERT INTO repository_review_batches(id, project_id, owner_id, options, scope, provider, model, status, idempotency_key)
      VALUES ($1, $2, $3, '{}'::jsonb, 'Selected Files', 'gemini', 'gemini-1.5', 'Completed', 'idem-1')
    `, [batchId, projectId, userId])
    await pool.query(`
      INSERT INTO repository_review_batch_files(batch_id, file_id, path, source_sha256, byte_count, line_count, ordinal, status)
      VALUES ($1, $2, 'src/app.js', 'hash1', $3, 1, 0, 'Reviewed')
    `, [batchId, jsFileId, Buffer.byteLength(jsContent)])

    // 4. Verify baseline rejects Python and oversized file before 0159
    await assert.rejects(
      () => pool.query(`
        INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
        VALUES ($1, $2, 'test.py', 'Python', 'print(1)', 8, 'hash')
      `, [crypto.randomUUID(), projectId]),
      /source_files_language_check/
    )

    const oversizedBefore = 'x'.repeat(600 * 1024)
    await assert.rejects(
      () => pool.query(`
        INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
        VALUES ($1, $2, 'big.js', 'JavaScript', $3, $4, 'hash')
      `, [crypto.randomUUID(), projectId, oversizedBefore, Buffer.byteLength(oversizedBefore)]),
      /source_files_byte_size_check/
    )

    // 5. Apply migration 0159 in isolated schema
    const upSql = fs.readFileSync(path.join(__dirname, '../scripts/migrations/0159-multi-language-source.sql'), 'utf8')
    await pool.query(upSql)

    // Verify existing JS and TS records are preserved
    const existingCheck = await pool.query('SELECT path, language, byte_size FROM source_files ORDER BY path')
    assert.strictEqual(existingCheck.rows.length, 2)
    assert.strictEqual(existingCheck.rows[0].path, 'src/app.js')
    assert.strictEqual(existingCheck.rows[0].language, 'JavaScript')
    assert.strictEqual(existingCheck.rows[1].path, 'src/types.ts')
    assert.strictEqual(existingCheck.rows[1].language, 'TypeScript')

    // 6. Test insertion of all 15 supported languages
    for (const item of ALL_15_LANGUAGES) {
      const fileId = crypto.randomUUID()
      const byteSize = Buffer.byteLength(item.content)
      const sha256 = crypto.createHash('sha256').update(item.content).digest('hex')

      const insertRes = await pool.query(`
        INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (project_id, path) DO UPDATE SET content = EXCLUDED.content, byte_size = EXCLUDED.byte_size, sha256 = EXCLUDED.sha256
        RETURNING id
      `, [fileId, projectId, item.file, item.lang, item.content, byteSize, sha256])
      const actualFileId = insertRes.rows[0].id

      // Verify chunking & GIN index works on this language
      await pool.query(`
        INSERT INTO source_chunks(file_id, ordinal, start_line, end_line, start_column, end_column, content)
        VALUES ($1, 0, 1, 1, 1, 1, $2)
        ON CONFLICT (file_id, ordinal) DO NOTHING
      `, [actualFileId, item.content.slice(0, 500)])
    }

    const totalCount = await pool.query('SELECT count(*)::int AS count FROM source_files')
    assert.strictEqual(totalCount.rows[0].count, 15)

    // 7. Test byte size limits after 0159:
    // a. 800 KiB file succeeds
    const content800k = 'A'.repeat(800 * 1024)
    const file800kId = crypto.randomUUID()
    await pool.query(`
      INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
      VALUES ($1, $2, 'large/sample.py', 'Python', $3, $4, 'hash800')
    `, [file800kId, projectId, content800k, Buffer.byteLength(content800k)])

    // b. Exactly 1 MiB (1048576 bytes) succeeds
    const content1m = 'B'.repeat(1048576)
    const file1mId = crypto.randomUUID()
    await pool.query(`
      INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
      VALUES ($1, $2, 'large/max.rs', 'Rust', $3, $4, 'hash1m')
    `, [file1mId, projectId, content1m, Buffer.byteLength(content1m)])

    // c. 1048577 bytes (1 MiB + 1 byte) fails
    const contentOversized = 'C'.repeat(1048577)
    await assert.rejects(
      () => pool.query(`
        INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
        VALUES ($1, $2, 'large/too_big.go', 'Go', $3, $4, 'hash_too_big')
      `, [crypto.randomUUID(), projectId, contentOversized, Buffer.byteLength(contentOversized)]),
      /source_files_byte_size_check/
    )

    // d. Unsupported language fails (e.g. Ruby, Haskell)
    await assert.rejects(
      () => pool.query(`
        INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
        VALUES ($1, $2, 'script.rb', 'Ruby', 'puts 1', 6, 'hash_rb')
      `, [crypto.randomUUID(), projectId]),
      /source_files_language_check/
    )

    // e. Batch review file with 800 KiB succeeds
    await pool.query(`
      INSERT INTO repository_review_batch_files(batch_id, file_id, path, source_sha256, byte_count, line_count, ordinal, status)
      VALUES ($1, $2, 'large/sample.py', 'hash800', 800 * 1024, 100, 1, 'Pending')
    `, [batchId, file800kId])

    // 8. Test Rollback Safety & Preflight Compatibility
    const downSql = fs.readFileSync(path.join(__dirname, '../scripts/migrations/0159-multi-language-source.down.sql'), 'utf8')

    // a. Rollback MUST fail while non-JS/TS and oversized files exist
    await assert.rejects(
      () => pool.query(downSql),
      /Cannot rollback 0159/
    )

    // Verify schema remains on 0159 after failed rollback attempt
    const langCheckAfterFailedRollback = await pool.query(`
      INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
      VALUES ($1, $2, 'still_python.py', 'Python', 'x=1', 3, 'h')
      RETURNING id
    `, [crypto.randomUUID(), projectId])
    assert.ok(langCheckAfterFailedRollback.rows[0].id)

    // b. Clean up non-JS/TS files and oversized files
    await pool.query('DELETE FROM repository_review_batch_files WHERE file_id = $1', [file800kId])
    await pool.query(`DELETE FROM source_files WHERE language NOT IN ('JavaScript', 'TypeScript') OR byte_size > 524288`)

    // c. Rollback MUST now succeed cleanly
    await pool.query(downSql)

    // Verify baseline JS/TS records are STILL intact after rollback
    const postRollback = await pool.query('SELECT path, language FROM source_files ORDER BY path')
    assert.strictEqual(postRollback.rows.length, 2)
    assert.strictEqual(postRollback.rows[0].language, 'JavaScript')
    assert.strictEqual(postRollback.rows[1].language, 'TypeScript')

    // Verify restored constraints reject Python and >512 KiB again
    await assert.rejects(
      () => pool.query(`
        INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
        VALUES ($1, $2, 'test.py', 'Python', 'print(1)', 8, 'h')
      `, [crypto.randomUUID(), projectId]),
      /source_files_language_check/
    )

    await assert.rejects(
      () => pool.query(`
        INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256)
        VALUES ($1, $2, 'big.js', 'JavaScript', $3, $4, 'h')
      `, [crypto.randomUUID(), projectId, oversizedBefore, Buffer.byteLength(oversizedBefore)]),
      /source_files_byte_size_check/
    )

  } finally {
    // 9. Teardown isolated schema completely
    if (pool) await pool.end().catch(() => {})
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {})
    await admin.end().catch(() => {})
  }
})
