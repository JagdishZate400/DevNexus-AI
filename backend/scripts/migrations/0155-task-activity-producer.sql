-- Phase 0154D. Explicit deployment only; requires 0154 and existing 0153 lifecycle triggers.
-- No backfill, new access grants, account deletion changes or additional event writers.
BEGIN;
SET LOCAL lock_timeout='5000ms';
SET LOCAL statement_timeout='30000ms';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='project_memberships'::regclass
  AND tgname='project_memberships_task_assignment_after_delete' AND tgenabled='O')
 OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='source_projects'::regclass
  AND tgname='source_projects_task_assignment_after_owner_update' AND tgenabled='O') THEN
  RAISE EXCEPTION 'Enabled assignment lifecycle triggers are required';
 END IF;
 PERFORM 'project_task_activity'::regclass;
END $$;

CREATE FUNCTION devnexus_task_activity_record() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
 ctx JSONB; actor_id UUID; actor_name TEXT; event_origin TEXT:='database';
 event_reason TEXT; cause TEXT; correlation UUID; field_name TEXT;
 old_value JSONB; new_value JSONB; events JSONB[]:=ARRAY[]::JSONB[]; item JSONB;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status
  AND OLD.assignee_user_id IS NOT DISTINCT FROM NEW.assignee_user_id
  AND OLD.sprint_id IS NOT DISTINCT FROM NEW.sprint_id THEN RETURN NEW; END IF;
 BEGIN
  ctx:=NULLIF(current_setting('devnexus.activity_context',true),'')::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN ctx:=NULL;
 END;
 -- Transaction/project scoping rejects stale session context and unrelated nested operations.
 IF jsonb_typeof(ctx)='object' AND ctx->'v'='1'::jsonb
  AND ctx->>'txid'=txid_current()::text AND ctx->>'projectId'=NEW.project_id THEN
  cause:=ctx->>'reason';
  IF ctx->>'correlationId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   correlation:=(ctx->>'correlationId')::uuid;
  END IF;
  IF ctx->>'actorUserId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   EXECUTE format('SELECT id,full_name FROM %I.users WHERE id=$1 FOR SHARE',TG_TABLE_SCHEMA)
    INTO actor_id,actor_name USING (ctx->>'actorUserId')::uuid;
   IF actor_id IS NOT NULL THEN event_origin:='api'; END IF;
  END IF;
 END IF;
 correlation:=COALESCE(correlation,gen_random_uuid());
 IF TG_OP='INSERT' THEN
  events:=array_append(events,jsonb_build_object('type','task_created','reason','task_created','changes',
   jsonb_build_object('version',1,'initial',jsonb_build_object('status',NEW.status,'assigneeUserId',NEW.assignee_user_id,'sprintId',NEW.sprint_id))));
 ELSE
  -- Deterministic order, including one shared correlation for a multi-field row change.
  FOREACH field_name IN ARRAY ARRAY['status','assignee_user_id','sprint_id'] LOOP
   old_value:=to_jsonb(OLD)->field_name; new_value:=to_jsonb(NEW)->field_name;
   IF old_value IS DISTINCT FROM new_value THEN
    event_reason:=CASE WHEN event_origin='api' THEN 'task_updated' ELSE 'unknown' END;
    IF field_name='assignee_user_id' AND cause IN ('membership_removed','owner_changed') AND new_value='null'::jsonb THEN
     event_reason:=cause;
    ELSIF field_name='sprint_id' THEN
     event_reason:=CASE WHEN event_origin='api' THEN 'sprint_link_changed' ELSE 'unknown' END;
    END IF;
    events:=array_append(events,jsonb_build_object('type',CASE field_name WHEN 'status' THEN 'status_changed'
     WHEN 'assignee_user_id' THEN 'assignment_changed' ELSE 'sprint_changed' END,'reason',event_reason,
     'changes',jsonb_build_object('version',1,'from',old_value,'to',new_value)));
   END IF;
  END LOOP;
 END IF;
 FOREACH item IN ARRAY events LOOP
  -- The only activity INSERT producer. Any failure propagates and rolls back its mutation.
  EXECUTE format('INSERT INTO %I.project_task_activity(task_id,actor_user_id,actor_display_name_snapshot,event_type,origin,reason,changes,correlation_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)',TG_TABLE_SCHEMA)
   USING NEW.id,actor_id,actor_name,item->>'type',event_origin,item->>'reason',item->'changes',correlation;
 END LOOP;
 RETURN NEW;
END;
$$;
CREATE TRIGGER project_tasks_activity_after_write AFTER INSERT OR UPDATE ON project_tasks
 FOR EACH ROW EXECUTE FUNCTION devnexus_task_activity_record();

-- Preserve trigger identities, lock order, eligibility and repeatable-snapshot rejection.
CREATE OR REPLACE FUNCTION devnexus_task_assignment_member_deleted() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE current_owner UUID; previous TEXT; ctx JSONB;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
  RAISE EXCEPTION 'Assignment lifecycle cleanup requires READ COMMITTED isolation' USING ERRCODE='40001';
 END IF;
 EXECUTE format('SELECT owner_id FROM %I.source_projects WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA)
  INTO current_owner USING OLD.project_id;
 IF current_owner IS NOT NULL AND current_owner IS DISTINCT FROM OLD.user_id THEN
  previous:=COALESCE(current_setting('devnexus.activity_context',true),'');
  BEGIN ctx:=NULLIF(previous,'')::jsonb; EXCEPTION WHEN invalid_text_representation THEN ctx:=NULL; END;
  IF jsonb_typeof(ctx) IS DISTINCT FROM 'object' OR ctx->'v' IS DISTINCT FROM '1'::jsonb
   OR ctx->>'txid' IS DISTINCT FROM txid_current()::text OR ctx->>'projectId' IS DISTINCT FROM OLD.project_id THEN
   ctx:=jsonb_build_object('v',1,'txid',txid_current()::text,'projectId',OLD.project_id,'correlationId',gen_random_uuid());
  END IF;
  PERFORM set_config('devnexus.activity_context',(ctx||jsonb_build_object('reason','membership_removed'))::text,true);
  EXECUTE format('UPDATE %I.project_tasks SET assignee_user_id=NULL,updated_at=now()
   WHERE project_id=$1 AND assignee_user_id=$2',TG_TABLE_SCHEMA) USING OLD.project_id,OLD.user_id;
  PERFORM set_config('devnexus.activity_context',previous,true);
 END IF;
 RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION devnexus_task_assignment_owner_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE previous TEXT; ctx JSONB;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
  RAISE EXCEPTION 'Assignment lifecycle cleanup requires READ COMMITTED isolation' USING ERRCODE='40001';
 END IF;
 previous:=COALESCE(current_setting('devnexus.activity_context',true),'');
 BEGIN ctx:=NULLIF(previous,'')::jsonb; EXCEPTION WHEN invalid_text_representation THEN ctx:=NULL; END;
 IF jsonb_typeof(ctx) IS DISTINCT FROM 'object' OR ctx->'v' IS DISTINCT FROM '1'::jsonb
  OR ctx->>'txid' IS DISTINCT FROM txid_current()::text OR ctx->>'projectId' IS DISTINCT FROM NEW.id THEN
  ctx:=jsonb_build_object('v',1,'txid',txid_current()::text,'projectId',NEW.id,'correlationId',gen_random_uuid());
 END IF;
 PERFORM set_config('devnexus.activity_context',(ctx||jsonb_build_object('reason','owner_changed'))::text,true);
 EXECUTE format('UPDATE %I.project_tasks t SET assignee_user_id=NULL,updated_at=now()
  WHERE t.project_id=$1 AND t.assignee_user_id IS NOT NULL AND t.assignee_user_id<>$2
   AND NOT EXISTS (SELECT 1 FROM %I.project_memberships m WHERE m.project_id=t.project_id AND m.user_id=t.assignee_user_id)',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA)
  USING NEW.id,NEW.owner_id;
 PERFORM set_config('devnexus.activity_context',previous,true);
 RETURN NEW;
END;
$$;
COMMIT;
