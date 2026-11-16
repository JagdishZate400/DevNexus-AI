const fs = require('fs')
const path = require('path')

async function applyDocumentationEvidenceRequestsMigration(pool) {
  const client = await pool.connect()
  try {
    const dbCheck = await client.query('SELECT current_database() AS db')
    if (dbCheck.rows[0]?.db !== 'devnexus_ai') {
      throw new Error(`Target database mismatch: expected devnexus_ai, got ${dbCheck.rows[0]?.db}`)
    }
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0157-documentation-evidence-requests.sql'), 'utf8')
    await client.query(sql)
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
    await applyDocumentationEvidenceRequestsMigration(pool)
    console.log('Migration 0157 applied: documentation evidence and generation request tracking ready. Existing documents and reviews unchanged.')
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  main().catch(error => {
    const sqlstate = /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : 'unavailable'
    console.error(`Documentation evidence requests migration failed (SQLSTATE: ${sqlstate}). Check connectivity, permissions, prerequisites and whether already applied. No credentials or raw errors logged.`)
    process.exitCode = 1
  })
}

module.exports = { applyDocumentationEvidenceRequestsMigration }
