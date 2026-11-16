require('../src/config')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('configuration')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 30000 })
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/0142-repository-review-batches.sql'), 'utf8'))
    console.log('D2.1 repository review batch migration applied.')
  } finally { await pool.end() }
}
main().catch(() => { console.error('Batch migration failed. Check connectivity, permissions and Phase A/D1 tables.'); process.exitCode = 1 })
