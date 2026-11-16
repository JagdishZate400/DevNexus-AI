-- Explicit additive migration; never applied automatically at startup.
BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';
CREATE TABLE project_tasks (
  id UUID PRIMARY KEY,
  project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(200) NOT NULL CHECK (length(btrim(title)) > 0),
  description VARCHAR(2000) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'To Do' CHECK (status IN ('To Do','In Progress','Done')),
  priority VARCHAR(10) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_tasks_project_history_idx ON project_tasks(project_id,created_at DESC,id DESC);
COMMIT;
