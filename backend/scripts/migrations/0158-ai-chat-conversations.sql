BEGIN;

SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

-- Table 1: AI Chat Conversations
CREATE TABLE IF NOT EXISTS ai_conversations (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(160) REFERENCES source_projects(id) ON DELETE SET NULL,
  created_by VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversations_id_chk CHECK (char_length(btrim(id)) >= 3 AND char_length(id) <= 64),
  CONSTRAINT ai_conversations_created_by_chk CHECK (char_length(btrim(created_by)) >= 3 AND char_length(created_by) <= 255),
  CONSTRAINT ai_conversations_title_chk CHECK (char_length(btrim(title)) > 0 AND char_length(title) <= 255)
);

CREATE INDEX IF NOT EXISTS ai_conversations_owner_idx ON ai_conversations(created_by, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ai_conversations_project_idx ON ai_conversations(project_id, updated_at DESC);

-- Table 2: AI Chat Conversation Messages
CREATE TABLE IF NOT EXISTS ai_conversation_messages (
  id VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(64) NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (octet_length(content) <= 32000),
  sources JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) <= 16),
  provider VARCHAR(40) CHECK (provider IS NULL OR provider IN ('gemini', 'grok', 'openrouter', 'fastapi', 'mock')),
  mode VARCHAR(40) CHECK (mode IS NULL OR mode IN ('repository', 'general')),
  grounded BOOLEAN NOT NULL DEFAULT false,
  notice TEXT CHECK (notice IS NULL OR char_length(notice) <= 500),
  ordinal INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversation_messages_id_chk CHECK (char_length(btrim(id)) >= 3 AND char_length(id) <= 64)
);

CREATE INDEX IF NOT EXISTS ai_conversation_messages_conv_idx ON ai_conversation_messages(conversation_id, created_at ASC, ordinal ASC);

COMMIT;
