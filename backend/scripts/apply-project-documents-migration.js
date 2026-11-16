const fs = require('fs')
const path = require('path')
async function applyProjectDocumentsMigration(pool) {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/0145-project-documents.sql'), 'utf8'))
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err }
  finally { client.release() }
}
async function main() {
  require('../src/config')
  if (!process.env.DATABASE_URL) throw new Error('configuration')
  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 35000 })
  try { await applyProjectDocumentsMigration(pool); console.log('Migration 0145 applied: durable project documents ready. Existing documents and reviews unchanged.') }
  finally { await pool.end() }
}
if (require.main === module) main().catch(() => {
  console.error('Document migration failed. Check connectivity, permissions, prerequisite source schema and whether already applied. No credentials or raw errors logged.')
  process.exitCode = 1
})
module.exports = { applyProjectDocumentsMigration }
