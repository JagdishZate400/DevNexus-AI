const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
const config = require('../src/config')
const {
  createConversationRepository,
} = require('../src/db/aiConversationRepository')

// Uses DATABASE_URL with an isolated temporary schema. Cleans up completely on finish.
test('isolated PostgreSQL AI conversations migration, durable CRUD, ownership, retry deduplication, and rollback', async (t) => {
  if (!config.databaseUrl) {
    t.skip('DATABASE_URL not configured for integration test')
    return
  }

  const schema = `ai_chat_test_${crypto.randomBytes(6).toString('hex')}`
  const admin = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
  })

  let pool = null
  let restartedPool = null

  try {
    // 1. Create isolated temporary schema
    await admin.query(`CREATE SCHEMA ${schema}`)
    const isolatedOptions = {
      connectionString: config.databaseUrl,
      options: `-c search_path=${schema}`,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    }
    pool = new Pool(isolatedOptions)

    // 2. Setup mock prerequisite tables in isolated schema
    await pool.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL
      );
      CREATE TABLE source_projects (
        id VARCHAR(160) PRIMARY KEY,
        owner_id UUID NOT NULL REFERENCES users(id),
        name VARCHAR(255) NOT NULL
      );
    `)

    const user1Id = crypto.randomUUID()
    const user2Id = crypto.randomUUID()
    const user1Email = 'alice@example.com'
    const user2Email = 'bob@example.com'
    const projectId = 'test-proj-01'

    await pool.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [
      user1Id,
      user1Email,
      user2Id,
      user2Email,
    ])
    await pool.query('INSERT INTO source_projects (id, owner_id, name) VALUES ($1, $2, $3)', [
      projectId,
      user1Id,
      'Test Project',
    ])

    // 3. Apply migration 0158 in isolated schema
    const upSql = fs.readFileSync(
      path.join(__dirname, '../scripts/migrations/0158-ai-chat-conversations.sql'),
      'utf8'
    )
    await pool.query(upSql)

    // 4. Test ready() detection
    let repo = createConversationRepository(pool)
    assert.equal(await repo.ready(), true, 'Repository should detect tables are ready')

    // 5. Test createConversation
    const conv1 = await repo.createConversation({
      id: 'conv-test-001',
      projectId,
      createdBy: user1Email,
      title: 'New Chat',
    })
    assert.equal(conv1.id, 'conv-test-001')
    assert.equal(conv1.projectId, projectId)
    assert.equal(conv1.createdBy, user1Email)
    assert.equal(conv1.title, 'New Chat')
    assert.deepEqual(conv1.messages, [])

    // 6. Test appendMessages with citations and title auto-update
    const userMsg = {
      id: 'msg-user-001',
      role: 'user',
      content: 'Explain add(a, b) and multiply(a, b)',
    }
    const assistantMsg = {
      id: 'msg-asst-001',
      role: 'assistant',
      content: 'Here is the math explanation [S1].',
      sources: [
        {
          citationId: 'S1',
          chunkId: 'chunk-101',
          path: 'src/utils.js',
          startLine: 1,
          endLine: 8,
          snippet: 'function add(a, b) { return a + b; }',
        },
      ],
      provider: 'gemini',
      mode: 'repository',
      grounded: true,
      notice: null,
    }

    const updated = await repo.appendMessages(
      conv1.id,
      user1Email,
      [userMsg, assistantMsg],
      { newTitle: 'Explain add(a, b)' }
    )

    assert.equal(updated.title, 'Explain add(a, b)')
    assert.equal(updated.messages.length, 2)
    assert.equal(updated.messages[0].id, 'msg-user-001')
    assert.equal(updated.messages[0].role, 'user')
    assert.equal(updated.messages[1].id, 'msg-asst-001')
    assert.equal(updated.messages[1].role, 'assistant')
    assert.equal(updated.messages[1].sources.length, 1)
    assert.equal(updated.messages[1].sources[0].path, 'src/utils.js')
    assert.equal(updated.messages[1].grounded, true)

    // 7. Test Retry Deduplication: appending message with existing ID does not duplicate
    await repo.appendMessages(conv1.id, user1Email, [userMsg])
    const afterDedupe = await repo.findConversation(conv1.id, user1Email)
    assert.equal(afterDedupe.messages.length, 2, 'Message count must not increase on duplicate message ID')

    // 8. Test Ownership & Isolation: user2 cannot see, find, or append to user1's conversation
    const user2List = await repo.listConversations(user2Email)
    assert.equal(user2List.length, 0, 'User 2 should see 0 conversations')

    const user2Find = await repo.findConversation(conv1.id, user2Email)
    assert.equal(user2Find, null, 'User 2 should not find User 1 conversation')

    await assert.rejects(
      async () => {
        await repo.appendMessages(conv1.id, user2Email, [
          { id: 'msg-hack', role: 'user', content: 'Unauthorized' },
        ])
      },
      (err) => {
        assert.equal(err.code, 'not_found')
        return true
      }
    )

    // 9. Test Reconnect / Process Restart Simulation
    // Close current pool, simulate server shutdown, start new pool on same database schema
    await pool.end()
    pool = null

    restartedPool = new Pool(isolatedOptions)
    const restartedRepo = createConversationRepository(restartedPool)

    const persisted = await restartedRepo.findConversation(conv1.id, user1Email)
    assert.ok(persisted, 'Conversation must survive connection pool restart')
    assert.equal(persisted.title, 'Explain add(a, b)')
    assert.equal(persisted.messages.length, 2)
    assert.equal(persisted.messages[1].sources[0].citationId, 'S1')

    // 10. Test Cascade Deletion: deleting conversation removes its messages
    const deleted = await restartedRepo.deleteConversation(conv1.id, user1Email)
    assert.equal(deleted, true)

    const findAfterDelete = await restartedRepo.findConversation(conv1.id, user1Email)
    assert.equal(findAfterDelete, null)

    const orphanedMessages = await restartedPool.query(
      'SELECT count(*)::int AS count FROM ai_conversation_messages WHERE conversation_id = $1',
      [conv1.id]
    )
    assert.equal(orphanedMessages.rows[0].count, 0, 'Messages must be cascade-deleted')

    // 11. Test Rollback script in isolated schema
    const downSql = fs.readFileSync(
      path.join(__dirname, '../scripts/migrations/0158-ai-chat-conversations.down.sql'),
      'utf8'
    )
    await restartedPool.query(downSql)

    const checkDropped = await restartedPool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = '${schema}' AND table_name IN ('ai_conversations', 'ai_conversation_messages')
    `)
    assert.equal(checkDropped.rows.length, 0, 'Tables must be dropped on rollback')
  } finally {
    if (pool) await pool.end().catch(() => {})
    if (restartedPool) await restartedPool.end().catch(() => {})
    // Drop temporary schema completely
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {})
    await admin.end().catch(() => {})
  }
})
