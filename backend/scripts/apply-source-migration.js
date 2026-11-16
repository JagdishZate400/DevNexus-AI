// Explicit administrative command; never invoked during application startup.
require('../src/config')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('configuration')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 30000 })
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0132-source-workspace.sql'), 'utf8')
    await pool.query(sql)
    console.log('Phase A source workspace migration applied.')
  } finally { await pool.end() }
}
main().catch(() => { console.error('Migration failed. Check DATABASE_URL, database permissions, and the existing users table. No credentials are printed.'); process.exitCode = 1 })
