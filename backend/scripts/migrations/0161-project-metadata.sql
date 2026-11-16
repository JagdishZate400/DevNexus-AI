-- Migration 0161: Persistent Project Metadata and Lifecycle Support
-- Target table: source_projects
-- Fully backward-compatible additive columns with defaults.

BEGIN;

SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

-- 1. Additive columns with defaults
ALTER TABLE source_projects
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stack TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;

-- 2. Constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_projects_status_check'
  ) THEN
    ALTER TABLE source_projects
      ADD CONSTRAINT source_projects_status_check
      CHECK (status IN ('Active', 'Archived', 'Analysis Complete'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_projects_progress_check'
  ) THEN
    ALTER TABLE source_projects
      ADD CONSTRAINT source_projects_progress_check
      CHECK (progress >= 0 AND progress <= 100);
  END IF;
END $$;

-- 3. Automatic updated_at trigger
CREATE OR REPLACE FUNCTION devnexus_source_projects_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS source_projects_set_updated_at_trig ON source_projects;
CREATE TRIGGER source_projects_set_updated_at_trig
BEFORE UPDATE ON source_projects
FOR EACH ROW
EXECUTE FUNCTION devnexus_source_projects_set_updated_at();

-- 4. Query indexes
CREATE INDEX IF NOT EXISTS source_projects_owner_created_idx
  ON source_projects(owner_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS source_projects_owner_updated_idx
  ON source_projects(owner_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS source_projects_status_idx
  ON source_projects(status);

-- No installation-specific data backfills in the public schema migration.

COMMIT;
