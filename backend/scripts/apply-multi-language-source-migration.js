const fs = require('fs')
const path = require('path')

async function applyMultiLanguageSourceMigration(pool) {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0159-multi-language-source.sql'), 'utf8')
    await client.query(sql)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function rollbackMultiLanguageSourceMigration(pool) {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0159-multi-language-source.down.sql'), 'utf8')
    await client.query(sql)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function main() {
  require('../src/config')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')
  const { Pool } = require('pg')
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 35000,
  })
  try {
    const isRollback = process.argv.includes('--down') || process.argv.includes('--rollback')
    if (isRollback) {
      await rollbackMultiLanguageSourceMigration(pool)
      console.log('Rollback 0159 applied: source_files reverted to JS/TS and 512 KiB.')
    } else {
      await applyMultiLanguageSourceMigration(pool)
      console.log('Migration 0159 applied: source_files now supports 15 languages and 1 MiB byte size.')
    }
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Multi-language source migration failed. No credentials logged.', err.message)
    process.exitCode = 1
  })
}

module.exports = {
  applyMultiLanguageSourceMigration,
  rollbackMultiLanguageSourceMigration,
}
