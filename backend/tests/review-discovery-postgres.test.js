require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Pool } = require('pg')
const { createSourceRepository } = require('../src/db/sourceRepository')

// Read-only CTE fixtures: no tables, source records, migrations or batches are created.
test('PostgreSQL discovery metrics match JS UTF-16/newline semantics and recheck ownership', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async () => {
  let metrics, args
  const owner = '00000000-0000-4000-8000-000000000001'
  const probe = { async query(sql, values) {
    if (sql.includes('count(f.id)')) return { rows: [{ id: 'probe', name: 'Probe', totalFiles: '1', totalBytes: '1' }] }
    if (sql.includes('SELECT f.id')) { metrics = sql; args = values }
    return { rows: [] }
  }, release() {} }
  await createSourceRepository({ async connect() { return probe } }).discoverReviewFiles('probe', owner)
  const prefix = `WITH source_projects AS (SELECT $1::varchar AS id,$2::uuid AS owner_id),
    source_files AS (SELECT '00000000-0000-4000-8000-000000000002'::uuid AS id,$1::varchar AS project_id,'probe.js'::varchar AS path,
      'JavaScript'::varchar AS language,repeat('a',64)::text AS sha256,$6::text AS content,octet_length($6::text) AS byte_size) `
  const pool = new Pool({ connectionString: process.env.SOURCE_TEST_DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 })
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN READ ONLY')
    for (const content of ['', 'a\r\nb\rc\n', '😀\n你好', 'x'.repeat(50000), '😀'.repeat(25001)]) {
      const result = (await client.query(prefix + metrics, [...args, content])).rows[0]
      assert.equal(result.characterCount, content.length)
      assert.equal(result.lineCount, content ? content.split(/\r\n|\n|\r/).length : 0)
      assert.equal(result.byteSize, Buffer.byteLength(content))
      assert.ok(!('content' in result))
    }
    const denied = await client.query(prefix.replace('SELECT $1::varchar AS id,$2::uuid AS owner_id', "SELECT $1::varchar AS id,'00000000-0000-4000-8000-000000000003'::uuid AS owner_id") + metrics, [...args, 'x'])
    assert.equal(denied.rows.length, 0)
  } finally { if (client) { await client.query('ROLLBACK').catch(() => {}); client.release() }; await pool.end() }
})
