-- Rollback for Phase 4: Reliable Asynchronous Source Indexing Jobs
BEGIN;

SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

DROP TABLE IF EXISTS source_indexing_jobs CASCADE;

COMMIT;
