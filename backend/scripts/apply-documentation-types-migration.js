const fs = require('fs')
const path = require('path')

async function applyDocumentationTypesMigration(pool) {
  const client = await pool.connect()
  try {
    const dbCheck = await client.query('SELECT current_database() AS db')
    if (dbCheck.rows[0]?.db !== 'devnexus_ai') {
      throw new Error(`Target database mismatch: expected devnexus_ai, got ${dbCheck.rows[0]?.db}`)
    }

    const beforeCount = (await client.query('SELECT count(*)::int AS count FROM project_documents')).rows[0].count

    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0156-documentation-types.sql'), 'utf8')
    await client.query(sql)

    const afterCount = (await client.query('SELECT count(*)::int AS count FROM project_documents')).rows[0].count
    if (beforeCount !== afterCount) {
      throw new Error(`Row count mismatch: before=${beforeCount}, after=${afterCount}`)
    }

    return { beforeCount, afterCount }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function main() {
  require('../src/config')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.')
  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 35000 })
  try {
    const { beforeCount, afterCount } = await applyDocumentationTypesMigration(pool)
    console.log(`Migration 0156 applied successfully: project_documents_document_type_d2_check active. Row count preserved (${beforeCount} -> ${afterCount}).`)
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  main().catch(error => {
    const sqlstate = /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : 'unavailable'
    console.error(`Documentation types migration failed (SQLSTATE: ${sqlstate}). Check connectivity, permissions, prerequisites and whether already applied. No credentials or raw errors logged.`)
    process.exitCode = 1
  })
}

module.exports = { applyDocumentationTypesMigration }
