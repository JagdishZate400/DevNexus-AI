require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
  applyAiConversationsMigration,
  rollbackAiConversationsMigration,
} = require('../scripts/apply-ai-conversations-migration')

const upSql = fs.readFileSync(
  path.join(__dirname, '../scripts/migrations/0158-ai-chat-conversations.sql'),
  'utf8'
)
const downSql = fs.readFileSync(
  path.join(__dirname, '../scripts/migrations/0158-ai-chat-conversations.down.sql'),
  'utf8'
)

test('0158 migration has bounded schema, foreign keys, indexes and transactional application', async () => {
  assert.match(upSql, /^BEGIN;/)
  assert.match(upSql, /COMMIT;\s*$/)
  assert.doesNotMatch(upSql, /ALTER TABLE|UPDATE |DELETE FROM|DROP /)

  // Verify constraints, checks, and foreign keys
  for (const expression of [
    'CREATE TABLE IF NOT EXISTS ai_conversations',
    'CREATE TABLE IF NOT EXISTS ai_conversation_messages',
    'REFERENCES source_projects(id) ON DELETE SET NULL',
    'REFERENCES ai_conversations(id) ON DELETE CASCADE',
    'ai_conversations_owner_idx',
    'ai_conversation_messages_conv_idx',
    "CHECK (role IN ('user', 'assistant'))",
    'octet_length(content) <= 32000',
    'jsonb_array_length(sources) <= 16',
  ]) {
    assert.ok(upSql.includes(expression), `Missing expected expression: ${expression}`)
  }

  // Test apply runner mock
  const calls = []
  let released = false
  await applyAiConversationsMigration({
    async connect() {
      return {
        async query(q) {
          calls.push(q)
        },
        release() {
          released = true
        },
      }
    },
  })
  assert.deepEqual(calls, ['SELECT 1', upSql])
  assert.ok(released)
})

test('0158 rollback migration is transactional and cleanly drops tables in reverse dependency order', async () => {
  assert.match(downSql, /^BEGIN;/)
  assert.match(downSql, /COMMIT;\s*$/)
  assert.ok(downSql.includes('DROP TABLE IF EXISTS ai_conversation_messages CASCADE;'))
  assert.ok(downSql.includes('DROP TABLE IF EXISTS ai_conversations CASCADE;'))

  const calls = []
  let released = false
  await rollbackAiConversationsMigration({
    async connect() {
      return {
        async query(q) {
          calls.push(q)
        },
        release() {
          released = true
        },
      }
    },
  })
  assert.deepEqual(calls, ['SELECT 1', downSql])
  assert.ok(released)
})

test('migration failure attempts rollback and releases connection safely', async () => {
  const calls = []
  let released = false
  await assert.rejects(
    applyAiConversationsMigration({
      async connect() {
        return {
          async query(q) {
            calls.push(q)
            if (q === upSql) throw new Error('simulated SQL failure')
          },
          release() {
            released = true
          },
        }
      },
    })
  )
  assert.equal(calls.at(-1), 'ROLLBACK')
  assert.ok(released)
})
