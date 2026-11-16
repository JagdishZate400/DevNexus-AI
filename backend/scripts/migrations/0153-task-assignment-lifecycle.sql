-- Phase 0152B3. Requires 0146, 0147, 0148 and 0152. Apply only after separate approval.
-- No backfill, startup execution, account-deletion FK changes or public transfer API.
BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

CREATE FUNCTION devnexus_task_assignment_member_deleted() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE current_owner UUID;
BEGIN
 -- Cleanup must see assignments committed while waiting for the project lock.
 -- A preexisting repeatable snapshot cannot guarantee this; abort rather than leave stale assignments.
 IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
  RAISE EXCEPTION 'Assignment lifecycle cleanup requires READ COMMITTED isolation'
   USING ERRCODE = '40001';
 END IF;
 EXECUTE format('SELECT owner_id FROM %I.source_projects WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA)
  INTO current_owner USING OLD.project_id;
 -- Parent may already be gone during a project cascade. Current owners remain eligible.
 IF current_owner IS NOT NULL AND current_owner IS DISTINCT FROM OLD.user_id THEN
  EXECUTE format('UPDATE %I.project_tasks SET assignee_user_id=NULL,updated_at=now()
   WHERE project_id=$1 AND assignee_user_id=$2',TG_TABLE_SCHEMA)
   USING OLD.project_id,OLD.user_id;
 END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER project_memberships_task_assignment_after_delete
 AFTER DELETE ON project_memberships FOR EACH ROW
 EXECUTE FUNCTION devnexus_task_assignment_member_deleted();

CREATE FUNCTION devnexus_task_assignment_owner_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
  RAISE EXCEPTION 'Assignment lifecycle cleanup requires READ COMMITTED isolation'
   USING ERRCODE = '40001';
 END IF;
 -- The ownership UPDATE already locks this project row before touching tasks.
 EXECUTE format('UPDATE %I.project_tasks t SET assignee_user_id=NULL,updated_at=now()
  WHERE t.project_id=$1 AND t.assignee_user_id IS NOT NULL AND t.assignee_user_id<>$2
   AND NOT EXISTS (SELECT 1 FROM %I.project_memberships m
    WHERE m.project_id=t.project_id AND m.user_id=t.assignee_user_id)',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA)
  USING NEW.id,NEW.owner_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER source_projects_task_assignment_after_owner_update
 AFTER UPDATE OF owner_id ON source_projects FOR EACH ROW
 WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id)
 EXECUTE FUNCTION devnexus_task_assignment_owner_changed();
COMMIT;
