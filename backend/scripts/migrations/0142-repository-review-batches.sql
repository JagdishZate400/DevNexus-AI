-- Additive D2.1 migration; requires Phase A and D1. Apply explicitly only.
BEGIN;
CREATE TABLE IF NOT EXISTS repository_review_batches (
  id UUID PRIMARY KEY,
  project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  options JSONB NOT NULL,
  scope VARCHAR(20) NOT NULL CHECK (scope='Selected Files'),
  provider VARCHAR(20) NOT NULL CHECK (provider='gemini'),
  model VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('Queued','In Progress','Completed','Partial','Failed')),
  idempotency_key VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS review_batches_owner_idx ON repository_review_batches(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS repository_review_batch_files (
  batch_id UUID NOT NULL REFERENCES repository_review_batches(id) ON DELETE CASCADE,
  -- Keep the manifest if a source file is deleted; worker records source_missing.
  file_id UUID NOT NULL,
  path VARCHAR(240) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  byte_count INTEGER NOT NULL CHECK (byte_count>=0 AND byte_count<=524288),
  line_count INTEGER NOT NULL CHECK (line_count>=0),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 2),
  status VARCHAR(20) NOT NULL CHECK (status IN ('Pending','Running','Reviewed','Skipped','Failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
  error_code VARCHAR(80),
  review_id UUID REFERENCES repository_reviews(id) ON DELETE SET NULL,
  claim_token UUID,
  lease_until TIMESTAMPTZ,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(batch_id,file_id),
  UNIQUE(batch_id,ordinal),
  CHECK ((status='Running') = (claim_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS review_batch_files_queue_idx ON repository_review_batch_files(status,available_at);
COMMIT;
