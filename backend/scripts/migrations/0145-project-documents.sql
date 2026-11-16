BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';
CREATE TABLE project_documents (
  id UUID PRIMARY KEY,
  project_id VARCHAR(160) NOT NULL REFERENCES source_projects(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES users(id),
  document_type VARCHAR(40) NOT NULL CHECK (document_type IN ('readme','project-overview','code-documentation','api-documentation','technical-architecture')),
  title VARCHAR(200) NOT NULL CHECK (length(btrim(title)) > 0),
  markdown TEXT NOT NULL DEFAULT '' CHECK (char_length(markdown) <= 50000 AND octet_length(markdown) <= 80000),
  generation_status VARCHAR(20) NOT NULL DEFAULT 'Draft' CHECK (generation_status IN ('Draft','Pending','Running','Completed','Failed')),
  provider VARCHAR(30) CHECK (provider = 'gemini'),
  model VARCHAR(120) CHECK (model ~ '^[a-zA-Z0-9._/-]{1,120}$'),
  source_references JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_references) = 'array' AND jsonb_array_length(source_references) <= 200),
  coverage JSONB NOT NULL DEFAULT '{"filesSubmitted":0,"filesIncluded":0,"filesSkipped":0,"filesFailed":0,"truncated":false}'::jsonb CHECK (jsonb_typeof(coverage) = 'object'),
  failure_code VARCHAR(40) CHECK (failure_code IN ('ai_timeout','ai_unavailable','ai_rate_limited','ai_quota','ai_authentication','ai_configuration','ai_model_unavailable','ai_invalid_response','ai_blocked','source_changed','generation_failed','worker_interrupted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((generation_status = 'Draft' AND provider IS NULL AND model IS NULL) OR (generation_status <> 'Draft' AND provider IS NOT NULL AND provider = 'gemini' AND model IS NOT NULL)),
  CHECK ((generation_status = 'Failed' AND failure_code IS NOT NULL) OR (generation_status <> 'Failed' AND failure_code IS NULL))
);
CREATE INDEX project_documents_project_history_idx ON project_documents(project_id, created_at DESC, id DESC);
COMMIT;
