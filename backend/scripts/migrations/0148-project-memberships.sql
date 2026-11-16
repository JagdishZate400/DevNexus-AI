-- Directory only: no authorization grants or changes to existing users/projects.
BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';
CREATE TABLE project_memberships (
 id UUID PRIMARY KEY,
 project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 added_by UUID NOT NULL REFERENCES users(id),
 display_role VARCHAR(20) NOT NULL CHECK (display_role IN ('Developer','Tester','Viewer')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT project_memberships_project_user_unique UNIQUE (project_id,user_id)
);
CREATE INDEX project_memberships_project_history_idx ON project_memberships(project_id,created_at DESC,id DESC);
COMMIT;
