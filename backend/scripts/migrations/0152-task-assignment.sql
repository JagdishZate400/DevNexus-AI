-- Phase 0152B1 only. Explicit application requires separate approval.
-- No backfill/default: existing tasks remain unassigned.
BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';
ALTER TABLE project_tasks ADD COLUMN assignee_user_id UUID;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_assignee_user_fk
 FOREIGN KEY (assignee_user_id) REFERENCES users(id) ON DELETE SET NULL;
-- Leading assignee supports FK cleanup; project-leading index supports project filters.
CREATE INDEX project_tasks_assignee_user_idx ON project_tasks(assignee_user_id) WHERE assignee_user_id IS NOT NULL;
CREATE INDEX project_tasks_project_assignee_idx ON project_tasks(project_id,assignee_user_id) WHERE assignee_user_id IS NOT NULL;
COMMIT;
