const fs = require('fs')
const path = require('path')

async function applyAiConversationsMigration(pool) {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0158-ai-chat-conversations.sql'), 'utf8')
    await client.query(sql)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function rollbackAiConversationsMigration(pool) {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0158-ai-chat-conversations.down.sql'), 'utf8')
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
      await rollbackAiConversationsMigration(pool)
      console.log('Rollback 0158 applied: ai_conversations and ai_conversation_messages removed.')
    } else {
      await applyAiConversationsMigration(pool)
      console.log('Migration 0158 applied: durable AI conversation tables ready.')
    }
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('AI Conversation migration failed. No credentials logged.', err.message)
    process.exitCode = 1
  })
}

module.exports = {
  applyAiConversationsMigration,
  rollbackAiConversationsMigration,
}
