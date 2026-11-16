-- Phase 4: Reliable Asynchronous Source Indexing Jobs
-- Requires Phase A (0132) and Phase B (0136) source workspace and index tables.
BEGIN;

SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

CREATE TABLE IF NOT EXISTS source_indexing_jobs (
  id UUID PRIMARY KEY,
  project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retrying')),
  total_files INTEGER NOT NULL DEFAULT 0 CHECK (total_files >= 0),
  processed_files INTEGER NOT NULL DEFAULT 0 CHECK (processed_files >= 0),
  indexed_files INTEGER NOT NULL DEFAULT 0 CHECK (indexed_files >= 0),
  excluded_files INTEGER NOT NULL DEFAULT 0 CHECK (excluded_files >= 0),
  failed_files INTEGER NOT NULL DEFAULT 0 CHECK (failed_files >= 0),
  current_batch INTEGER NOT NULL DEFAULT 0 CHECK (current_batch >= 0),
  total_batches INTEGER NOT NULL DEFAULT 0 CHECK (total_batches >= 0),
  batch_size INTEGER NOT NULL DEFAULT 50 CHECK (batch_size BETWEEN 1 AND 500),
  claim_token UUID,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  error_code VARCHAR(80),
  error_message VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS source_indexing_jobs_project_idx ON source_indexing_jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS source_indexing_jobs_queue_idx ON source_indexing_jobs(status, lease_until) WHERE status IN ('pending', 'processing', 'retrying');

COMMIT;
