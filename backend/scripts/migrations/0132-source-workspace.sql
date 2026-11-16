-- Apply explicitly; the application never runs migrations automatically.
BEGIN;
CREATE TABLE IF NOT EXISTS source_projects (
  id VARCHAR(160) PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS source_projects_owner_idx ON source_projects(owner_id);
CREATE TABLE IF NOT EXISTS source_files (
  id UUID PRIMARY KEY,
  project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
  path VARCHAR(240) NOT NULL,
  language VARCHAR(20) NOT NULL CHECK (language IN ('JavaScript', 'TypeScript')),
  content TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 0 AND 524288),
  sha256 CHAR(64) NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, path),
  CHECK (octet_length(content) = byte_size)
);
CREATE UNIQUE INDEX IF NOT EXISTS source_files_path_lower_idx ON source_files(project_id, lower(path));
COMMIT;
