-- D2 forward-only contract extension. Explicit application only.
-- Keep legacy values and every historical row unchanged. No source upload changes.
BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';
-- Fail closed on unexpected schema drift rather than dropping an arbitrary check.
DO $$
DECLARE definition TEXT; accepted TEXT[];
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
 WHERE conrelid='public.project_documents'::regclass
 AND conname='project_documents_document_type_check' AND contype='c';
 SELECT array_agg(parts[1] ORDER BY parts[1]) INTO accepted
 FROM regexp_matches(definition, '''([^'']+)''', 'g') AS captured(parts);
 IF accepted IS DISTINCT FROM ARRAY['api-documentation','code-documentation',
 'project-overview','readme','technical-architecture']::TEXT[] THEN
  RAISE EXCEPTION 'Expected document type constraint missing or incompatible';
 END IF;
END $$;
ALTER TABLE public.project_documents ADD CONSTRAINT project_documents_document_type_d2_check
 CHECK (document_type IN ('readme','project-overview','installation-guide','architecture',
 'project-structure','module-documentation','api-documentation','developer-notes','technology-stack',
 'technical-architecture','code-documentation')) NOT VALID;
ALTER TABLE public.project_documents VALIDATE CONSTRAINT project_documents_document_type_d2_check;
ALTER TABLE public.project_documents DROP CONSTRAINT project_documents_document_type_check;
COMMIT;
