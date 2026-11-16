require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

// Uses an already migrated separate test database. No migrations or fixture batches.
test('PostgreSQL prepares and executes every finalization state without 42P08', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/db/reviewBatchRepository.js'), 'utf8')
  const sql = source.match(/await client\.query\(`(UPDATE repository_review_batch_files SET status=\$4[\s\S]*?WHERE batch_id=\$1 AND file_id=\$2 AND claim_token=\$3)`/)[1]
  const pool = new Pool({ connectionString: process.env.SOURCE_TEST_DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 })
  let client
  try {
    client = await pool.connect()
    for (const state of ['Reviewed', 'Pending', 'Skipped', 'Failed']) {
      await client.query('BEGIN')
      try {
        await client.query("SET LOCAL statement_timeout='5000ms'")
        await client.query("SET LOCAL lock_timeout='2000ms'")
        // NULL equality cannot match any existing record, regardless of its identity.
        const result = await client.query(sql, [null, null, null, state, state === 'Pending' || state === 'Failed' ? 'ai_timeout' : null, state === 'Pending' ? 60 : 0])
        assert.equal(result.rowCount, 0)
      } finally { await client.query('ROLLBACK') }
    }
  } finally { if (client) client.release(); await pool.end() }
})
