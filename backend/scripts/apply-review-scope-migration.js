const fs = require('fs')
const path = require('path')

async function applyReviewScopeMigration(pool) {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1') // Validate connectivity before the transactional migration.
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/0143-review-scope-foundation.sql'), 'utf8'))
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally { client.release() }
}
async function main() {
  require('../src/config')
  if (!process.env.DATABASE_URL) throw new Error('configuration')
  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 35000 })
  try {
    await applyReviewScopeMigration(pool)
    console.log('D2.2.1 review scope foundation migration applied. Full-project creation remains disabled.')
  } finally { await pool.end() }
}
if (require.main === module) main().catch(() => {
  console.error('Review scope migration failed. Check connectivity, permissions, D2.1 tables and active database locks. No credentials or raw errors logged.')
  process.exitCode = 1
})
module.exports = { applyReviewScopeMigration }
