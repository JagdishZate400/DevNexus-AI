-- Explicit additive migration. Existing tasks remain unassigned.
BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';
CREATE TABLE project_sprints (
 id UUID PRIMARY KEY,
 project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
 creator_id UUID NOT NULL REFERENCES users(id),
 name VARCHAR(160) NOT NULL CHECK (length(btrim(name)) > 0),
 goal VARCHAR(1000) NOT NULL DEFAULT '',
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'Planning' CHECK (status IN ('Planning','Active','Completed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT project_sprints_date_order CHECK (end_date >= start_date),
 CONSTRAINT project_sprints_id_project_unique UNIQUE (id,project_id)
);
CREATE INDEX project_sprints_project_history_idx ON project_sprints(project_id,created_at DESC,id DESC);
ALTER TABLE project_tasks ADD COLUMN sprint_id UUID;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_sprint_project_fk
 FOREIGN KEY (sprint_id,project_id) REFERENCES project_sprints(id,project_id);
CREATE INDEX project_tasks_sprint_idx ON project_tasks(sprint_id,project_id);
COMMIT;
