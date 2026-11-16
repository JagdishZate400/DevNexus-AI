-- Phase 0154B: additive storage contract only. Apply explicitly, never at startup.
-- Parent task ownership remains the authorization boundary. No activity producer yet.
BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

CREATE TABLE project_task_comments (
 id UUID PRIMARY KEY,
 task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
 author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
 author_display_name_snapshot VARCHAR(150) NOT NULL,
 body TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 position BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 client_request_id UUID NOT NULL,
 CONSTRAINT project_task_comments_author_name_check
  CHECK (author_display_name_snapshot ~ '[^[:space:]]'),
 CONSTRAINT project_task_comments_body_check
  CHECK (char_length(body) BETWEEN 1 AND 4000 AND body ~ '[^[:space:]]'),
 CONSTRAINT project_task_comments_task_request_unique UNIQUE (task_id,client_request_id)
);
CREATE INDEX project_task_comments_task_page_idx ON project_task_comments(task_id,position DESC);
CREATE INDEX project_task_comments_author_user_idx ON project_task_comments(author_user_id)
 WHERE author_user_id IS NOT NULL;

CREATE TABLE project_task_activity (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
 actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
 actor_display_name_snapshot VARCHAR(150),
 event_type VARCHAR(32) NOT NULL,
 origin VARCHAR(16) NOT NULL,
 reason VARCHAR(32) NOT NULL,
 changes JSONB NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 correlation_id UUID,
 CONSTRAINT project_task_activity_actor_name_check CHECK (
  (actor_user_id IS NULL OR actor_display_name_snapshot IS NOT NULL)
  AND (actor_display_name_snapshot IS NULL OR actor_display_name_snapshot ~ '[^[:space:]]')
 ),
 CONSTRAINT project_task_activity_event_type_check CHECK (
  event_type IN ('task_created','status_changed','assignment_changed','sprint_changed')
 ),
 CONSTRAINT project_task_activity_origin_check CHECK (origin IN ('api','database')),
 CONSTRAINT project_task_activity_reason_check CHECK (
  reason IN ('task_created','task_updated','sprint_link_changed','membership_removed','owner_changed','unknown')
 ),
 CONSTRAINT project_task_activity_event_reason_check CHECK (
  (event_type='task_created' AND reason='task_created')
  OR (event_type='status_changed' AND reason IN ('task_updated','unknown'))
  OR (event_type='assignment_changed' AND reason IN ('task_updated','membership_removed','owner_changed','unknown'))
  OR (event_type='sprint_changed' AND reason IN ('sprint_link_changed','unknown'))
 ),
 CONSTRAINT project_task_activity_cleanup_check CHECK ((
  reason NOT IN ('membership_removed','owner_changed') OR changes->'to'='null'::jsonb
 ) IS TRUE),
 -- Require a numeric version and exact envelope. IS TRUE closes SQL NULL holes.
 CONSTRAINT project_task_activity_changes_envelope_check CHECK ((
  jsonb_typeof(changes)='object' AND changes->'version'='1'::jsonb
  AND octet_length(changes::text)<=8192
  AND CASE WHEN event_type='task_created' THEN
   changes ?& ARRAY['version','initial']
   AND changes-ARRAY['version','initial']='{}'::jsonb
   AND jsonb_typeof(changes->'initial')='object'
   AND (changes->'initial') ?& ARRAY['status','assigneeUserId','sprintId']
   AND (changes->'initial')-ARRAY['status','assigneeUserId','sprintId']='{}'::jsonb
  ELSE
   changes ?& ARRAY['version','from','to']
   AND changes-ARRAY['version','from','to']='{}'::jsonb
   AND changes->'from' IS DISTINCT FROM changes->'to'
  END
 ) IS TRUE),
 CONSTRAINT project_task_activity_changes_values_check CHECK ((
  CASE WHEN event_type='task_created' THEN
   (changes->'initial'->'status') IN ('"To Do"'::jsonb,'"In Progress"'::jsonb,'"Done"'::jsonb)
   AND ((changes->'initial'->'assigneeUserId')='null'::jsonb OR
    (changes->'initial'->>'assigneeUserId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
   AND ((changes->'initial'->'sprintId')='null'::jsonb OR
    (changes->'initial'->>'sprintId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  WHEN event_type='status_changed' THEN
   (changes->'from') IN ('"To Do"'::jsonb,'"In Progress"'::jsonb,'"Done"'::jsonb)
   AND (changes->'to') IN ('"To Do"'::jsonb,'"In Progress"'::jsonb,'"Done"'::jsonb)
  ELSE
   ((changes->'from')='null'::jsonb OR (changes->>'from') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
   AND ((changes->'to')='null'::jsonb OR (changes->>'to') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  END
 ) IS TRUE)
);
CREATE INDEX project_task_activity_task_page_idx ON project_task_activity(task_id,id DESC);
CREATE INDEX project_task_activity_actor_user_idx ON project_task_activity(actor_user_id)
 WHERE actor_user_id IS NOT NULL;
COMMIT;
