const crypto = require('crypto')

function normalizeConversationRow(row) {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId || null,
    createdBy: row.createdBy,
    messages: (row.messages || []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: Array.isArray(m.sources) ? m.sources : [],
      provider: m.provider || undefined,
      mode: m.mode || undefined,
      grounded: Boolean(m.grounded),
      notice: m.notice || undefined,
      createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
    })),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
}

function createConversationRepository(pool) {
  return {
    async ready() {
      try {
        const res = await pool.query(
          "SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_conversations'"
        )
        return res.rows.length > 0
      } catch {
        return false
      }
    },

    async listConversations(userEmail, { projectId } = {}) {
      let text = `SELECT c.id, c.project_id AS "projectId", c.created_by AS "createdBy", c.title,
        c.created_at AS "createdAt", c.updated_at AS "updatedAt",
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'role', m.role,
              'content', m.content,
              'sources', m.sources,
              'provider', m.provider,
              'mode', m.mode,
              'grounded', m.grounded,
              'notice', m.notice,
              'createdAt', m.created_at
            ) ORDER BY m.created_at ASC, m.ordinal ASC
          ) FROM ai_conversation_messages m WHERE m.conversation_id = c.id),
          '[]'::jsonb
        ) AS messages
        FROM ai_conversations c
        WHERE c.created_by = $1`
      const values = [userEmail]

      if (projectId) {
        text += ` AND c.project_id = $2`
        values.push(projectId)
      }

      text += ` ORDER BY c.updated_at DESC, c.id DESC`
      const res = await pool.query({ text, values, query_timeout: 10000 })
      return res.rows.map(normalizeConversationRow)
    },

    async findConversation(id, userEmail) {
      const text = `SELECT c.id, c.project_id AS "projectId", c.created_by AS "createdBy", c.title,
        c.created_at AS "createdAt", c.updated_at AS "updatedAt",
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'role', m.role,
              'content', m.content,
              'sources', m.sources,
              'provider', m.provider,
              'mode', m.mode,
              'grounded', m.grounded,
              'notice', m.notice,
              'createdAt', m.created_at
            ) ORDER BY m.created_at ASC, m.ordinal ASC
          ) FROM ai_conversation_messages m WHERE m.conversation_id = c.id),
          '[]'::jsonb
        ) AS messages
        FROM ai_conversations c
        WHERE c.id = $1 AND c.created_by = $2`
      const res = await pool.query({ text, values: [id, userEmail], query_timeout: 10000 })
      if (!res.rows.length) return null
      return normalizeConversationRow(res.rows[0])
    },

    async createConversation({ id, projectId, createdBy, title }) {
      const convId = id || `conv-${crypto.randomUUID().slice(0, 8)}`
      const text = `INSERT INTO ai_conversations (id, project_id, created_by, title, created_at, updated_at)
        VALUES ($1, $2, $3, $4, now(), now())
        RETURNING id, project_id AS "projectId", created_by AS "createdBy", title,
          created_at AS "createdAt", updated_at AS "updatedAt"`
      const values = [convId, projectId || null, createdBy, title || 'New Chat']
      const res = await pool.query({ text, values, query_timeout: 10000 })
      return {
        ...normalizeConversationRow(res.rows[0]),
        messages: [],
      }
    },

    async deleteConversation(id, userEmail) {
      const res = await pool.query({
        text: 'DELETE FROM ai_conversations WHERE id = $1 AND created_by = $2 RETURNING id',
        values: [id, userEmail],
        query_timeout: 10000,
      })
      return res.rows.length > 0
    },

    async appendMessages(conversationId, userEmail, messagesToAdd, { newTitle } = {}) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SET LOCAL statement_timeout = '10000ms'")

        // Verify conversation ownership
        const checkRes = await client.query(
          'SELECT id, title FROM ai_conversations WHERE id = $1 AND created_by = $2 FOR UPDATE',
          [conversationId, userEmail]
        )
        if (!checkRes.rows.length) {
          const err = new Error('Conversation not found')
          err.code = 'not_found'
          err.status = 404
          throw err
        }

        // Get max ordinal for this conversation
        const ordRes = await client.query(
          'SELECT COALESCE(MAX(ordinal), 0)::int AS "maxOrdinal" FROM ai_conversation_messages WHERE conversation_id = $1',
          [conversationId]
        )
        let nextOrdinal = ordRes.rows[0].maxOrdinal

        for (const msg of messagesToAdd) {
          nextOrdinal += 1
          const msgId = msg.id || `msg-${crypto.randomUUID().slice(0, 8)}`
          await client.query(
            `INSERT INTO ai_conversation_messages (
              id, conversation_id, role, content, sources, provider, mode, grounded, notice, ordinal, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
            ON CONFLICT (id) DO NOTHING`,
            [
              msgId,
              conversationId,
              msg.role,
              msg.content,
              JSON.stringify(Array.isArray(msg.sources) ? msg.sources : []),
              msg.provider || null,
              msg.mode || null,
              Boolean(msg.grounded),
              msg.notice || null,
              nextOrdinal,
            ]
          )
        }

        // Update conversation updated_at and title if 'New Chat'
        await client.query(
          `UPDATE ai_conversations
           SET updated_at = now(),
               title = CASE WHEN title = 'New Chat' AND $3::text IS NOT NULL THEN $3::text ELSE title END
           WHERE id = $1 AND created_by = $2`,
          [conversationId, userEmail, newTitle || null]
        )

        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }

      // Return refreshed conversation
      return this.findConversation(conversationId, userEmail)
    },
  }
}

function createMemoryConversationRepository(store = []) {
  return {
    async ready() {
      return true
    },

    async listConversations(userEmail, { projectId } = {}) {
      let list = store.filter((c) => c.createdBy === userEmail)
      if (projectId) list = list.filter((c) => c.projectId === projectId)
      return list
        .slice()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((c) => ({
          ...c,
          messages: c.messages || [],
        }))
    },

    async findConversation(id, userEmail) {
      const conv = store.find((c) => c.id === id && c.createdBy === userEmail)
      if (!conv) return null
      return {
        ...conv,
        messages: conv.messages || [],
      }
    },

    async createConversation({ id, projectId, createdBy, title }) {
      const conv = {
        id: id || `conv-${crypto.randomUUID().slice(0, 8)}`,
        title: title || 'New Chat',
        projectId: projectId || null,
        createdBy,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      store.unshift(conv)
      return conv
    },

    async deleteConversation(id, userEmail) {
      const idx = store.findIndex((c) => c.id === id && c.createdBy === userEmail)
      if (idx < 0) return false
      store.splice(idx, 1)
      return true
    },

    async appendMessages(conversationId, userEmail, messagesToAdd, { newTitle } = {}) {
      const conv = store.find((c) => c.id === conversationId && c.createdBy === userEmail)
      if (!conv) {
        const err = new Error('Conversation not found')
        err.code = 'not_found'
        err.status = 404
        throw err
      }

      conv.messages = conv.messages || []
      for (const msg of messagesToAdd) {
        // Retry deduplication by ID
        if (!conv.messages.some((m) => m.id === msg.id)) {
          conv.messages.push({
            id: msg.id || `msg-${crypto.randomUUID().slice(0, 8)}`,
            role: msg.role,
            content: msg.content,
            sources: msg.sources || [],
            provider: msg.provider,
            mode: msg.mode,
            grounded: Boolean(msg.grounded),
            notice: msg.notice,
            createdAt: new Date().toISOString(),
          })
        }
      }

      if (conv.title === 'New Chat' && newTitle) {
        conv.title = newTitle
      }
      conv.updatedAt = new Date().toISOString()
      return conv
    },
  }
}

function createResilientConversationRepository(pool, fallbackStore = []) {
  const pgRepo = pool ? createConversationRepository(pool) : null
  const memRepo = createMemoryConversationRepository(fallbackStore)
  let isPgReady = null

  async function getActiveRepo() {
    if (!pgRepo) return memRepo
    if (isPgReady === true) return pgRepo
    try {
      const ready = await pgRepo.ready()
      if (ready) {
        isPgReady = true
        return pgRepo
      }
    } catch {
      // Fallback on error
    }
    return memRepo
  }

  return {
    async ready() {
      const active = await getActiveRepo()
      return active.ready()
    },
    async isPostgres() {
      const active = await getActiveRepo()
      return active === pgRepo
    },
    async listConversations(userEmail, opts) {
      const active = await getActiveRepo()
      return active.listConversations(userEmail, opts)
    },
    async findConversation(id, userEmail) {
      const active = await getActiveRepo()
      return active.findConversation(id, userEmail)
    },
    async createConversation(data) {
      const active = await getActiveRepo()
      return active.createConversation(data)
    },
    async deleteConversation(id, userEmail) {
      const active = await getActiveRepo()
      return active.deleteConversation(id, userEmail)
    },
    async appendMessages(id, userEmail, messages, opts) {
      const active = await getActiveRepo()
      return active.appendMessages(id, userEmail, messages, opts)
    },
  }
}

module.exports = {
  createConversationRepository,
  createMemoryConversationRepository,
  createResilientConversationRepository,
  normalizeConversationRow,
}
