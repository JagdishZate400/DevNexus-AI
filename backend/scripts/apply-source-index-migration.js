// Explicit schema command; application startup never invokes this.
require('../src/config')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('configuration')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 30000 })
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/0136-source-index.sql'), 'utf8'))
    console.log('Phase B source index migration applied. Run the explicit backfill command for existing source.')
  } finally { await pool.end() }
}
main().catch(() => { console.error('Index migration failed. Check database connectivity, permissions, and the Phase A tables.'); process.exitCode = 1 })
