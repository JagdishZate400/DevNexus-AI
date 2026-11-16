require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
const { applyReviewScopeMigration } = require('../scripts/apply-review-scope-migration')

test('isolated PostgreSQL scope migration preserves rows/keys/FKs and accepts ordinals 0–199', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async () => {
  const schema = `scope_test_${crypto.randomBytes(8).toString('hex')}`
  const connectionString = process.env.SOURCE_TEST_DATABASE_URL
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
  let pool, client
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 })
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)')
    for (const name of ['0132-source-workspace.sql', '0141-repository-reviews.sql', '0142-repository-review-batches.sql']) await pool.query(fs.readFileSync(path.join(__dirname, '../scripts/migrations', name), 'utf8'))
    const owner = crypto.randomUUID(), batch = crypto.randomUUID(), fid = crypto.randomUUID(), hash = 'a'.repeat(64)
    await pool.query('INSERT INTO users VALUES($1)', [owner])
    await pool.query("INSERT INTO source_projects(id,owner_id,name) VALUES('p',$1,'Test')", [owner])
    await pool.query(`INSERT INTO repository_review_batches(id,project_id,owner_id,options,scope,provider,model,status,idempotency_key)
      VALUES($1,'p',$2,'{}','Selected Files','gemini','test-model','Completed','legacy')`, [batch, owner])
    await pool.query(`INSERT INTO repository_review_batch_files(batch_id,file_id,path,source_sha256,byte_count,line_count,ordinal,status)
      VALUES($1,$2,'a.js',$3,1,1,2,'Reviewed')`, [batch, fid, hash])
    async function snapshot() {
      return [
        (await pool.query('SELECT to_jsonb(b) AS record FROM repository_review_batches b WHERE id=$1', [batch])).rows,
        (await pool.query('SELECT to_jsonb(f) AS record FROM repository_review_batch_files f WHERE batch_id=$1', [batch])).rows,
      ]
    }
    async function keys() {
      return (await pool.query(`SELECT c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
        WHERE k.conrelid IN ('repository_review_batches'::regclass,'repository_review_batch_files'::regclass) AND k.contype IN ('p','u','f') ORDER BY c.relname,k.conname`)).rows
    }
    const before = await snapshot(), originalKeys = await keys()
    await applyReviewScopeMigration(pool)
    assert.deepEqual(await snapshot(), before)
    assert.deepEqual(await keys(), originalKeys)
    assert.ok(originalKeys.some((k) => k.conname === 'repository_review_batch_files_pkey'))
    assert.ok(originalKeys.some((k) => k.conname === 'repository_review_batch_files_batch_id_ordinal_key'))
    const projectBatch = crypto.randomUUID()
    await pool.query(`INSERT INTO repository_review_batches(id,project_id,owner_id,options,scope,provider,model,status,idempotency_key)
      VALUES($1,'p',$2,'{}','Entire Project','gemini','test-model','Queued','project-fixture')`, [projectBatch, owner])
    const insert = `INSERT INTO repository_review_batch_files(batch_id,file_id,path,source_sha256,byte_count,line_count,ordinal,status)
      VALUES($1,$2,'a.js',$3,1,1,$4,'Pending')`
    for (const ordinal of [0, 2, 3, 199]) await pool.query(insert, [projectBatch, crypto.randomUUID(), hash, ordinal])
    client = await pool.connect()
    await client.query('BEGIN')
    async function rejected(sql, values, code) {
      await client.query('SAVEPOINT invalid_value')
      try { await assert.rejects(client.query(sql, values), (e) => e.code === code) }
      finally { await client.query('ROLLBACK TO SAVEPOINT invalid_value') }
    }
    for (const ordinal of [-1, 200]) await rejected(insert, [projectBatch, crypto.randomUUID(), hash, ordinal], '23514')
    await rejected(insert, [projectBatch, crypto.randomUUID(), hash, 199], '23505')
    await rejected(insert, [batch, fid, hash, 0], '23505')
    await rejected("UPDATE repository_review_batches SET scope='Folder' WHERE id=$1", [projectBatch], '23514')
    await client.query('ROLLBACK'); client.release(); client = null
    await applyReviewScopeMigration(pool) // Reapplication preserves data and constraints too.
    assert.deepEqual(await snapshot(), before)
    assert.deepEqual(await keys(), originalKeys)
  } finally {
    if (client) { await client.query('ROLLBACK').catch(() => {}); client.release() }
    if (pool) await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.end()
  }
})
