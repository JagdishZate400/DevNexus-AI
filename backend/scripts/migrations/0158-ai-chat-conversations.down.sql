BEGIN;

SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

DROP TABLE IF EXISTS ai_conversation_messages CASCADE;
DROP TABLE IF EXISTS ai_conversations CASCADE;

COMMIT;
