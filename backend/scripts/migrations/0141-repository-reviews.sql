-- Explicit D1 migration. Requires users and Phase A source tables.
BEGIN;
CREATE TABLE IF NOT EXISTS repository_reviews (
  id UUID PRIMARY KEY,
  project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  source_sha256 CHAR(64) NOT NULL,
  file_path VARCHAR(240) NOT NULL,
  provider VARCHAR(20) NOT NULL CHECK (provider='gemini'),
  model VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('In Progress','Completed','Failed')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  coverage JSONB NOT NULL,
  options JSONB NOT NULL,
  error_code VARCHAR(80)
);
CREATE INDEX IF NOT EXISTS repository_reviews_project_idx ON repository_reviews(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS repository_review_findings (
  id VARCHAR(80) PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES repository_reviews(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('Critical','High','Medium','Low','Info')),
  category VARCHAR(80) NOT NULL,
  line INTEGER NOT NULL CHECK (line>0),
  problem VARCHAR(500) NOT NULL,
  explanation VARCHAR(1000) NOT NULL,
  improvement VARCHAR(1000) NOT NULL,
  code VARCHAR(2000) NOT NULL,
  suggested_code VARCHAR(2000) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Reviewed','False Positive','Fixed')),
  UNIQUE(review_id,ordinal)
);
COMMIT;
