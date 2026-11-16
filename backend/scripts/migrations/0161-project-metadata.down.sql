-- Migration 0161 Down: Revert Persistent Project Metadata
BEGIN;

SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

DROP TRIGGER IF EXISTS source_projects_set_updated_at_trig ON source_projects;
DROP FUNCTION IF EXISTS devnexus_source_projects_set_updated_at();

DROP INDEX IF EXISTS source_projects_owner_created_idx;
DROP INDEX IF EXISTS source_projects_owner_updated_idx;
DROP INDEX IF EXISTS source_projects_status_idx;

ALTER TABLE source_projects
  DROP CONSTRAINT IF EXISTS source_projects_status_check,
  DROP CONSTRAINT IF EXISTS source_projects_progress_check,
  DROP COLUMN IF EXISTS progress,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS stack,
  DROP COLUMN IF EXISTS description;

COMMIT;
