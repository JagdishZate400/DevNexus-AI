const fs = require('fs');
const path = require('path');

async function applySourceIndexingMigration(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0160-source-indexing-jobs.sql'), 'utf8');
    await client.query(sql);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function rollbackSourceIndexingMigration(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0160-source-indexing-jobs.down.sql'), 'utf8');
    await client.query(sql);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  require('../src/config');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 35000,
  });
  try {
    const isRollback = process.argv.includes('--down') || process.argv.includes('--rollback');
    if (isRollback) {
      await rollbackSourceIndexingMigration(pool);
      console.log('Rollback 0160 applied: source_indexing_jobs dropped.');
    } else {
      await applySourceIndexingMigration(pool);
      console.log('Migration 0160 applied: source_indexing_jobs table and indexes created.');
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Source indexing migration failed. No credentials logged.', err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  applySourceIndexingMigration,
  rollbackSourceIndexingMigration,
};
