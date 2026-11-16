-- D3A. File only; explicit deployment. Independent of task migrations.
BEGIN;
SET LOCAL lock_timeout='5000ms';
SET LOCAL statement_timeout='30000ms';
CREATE TABLE public.project_document_requests (
 owner_id UUID NOT NULL REFERENCES public.users(id),
 request_id UUID NOT NULL,
 project_id VARCHAR(160) NOT NULL REFERENCES public.source_projects(id) ON DELETE CASCADE,
 document_type VARCHAR(40) NOT NULL,
 -- Preserve a key tombstone when the existing delete API removes a document.
 document_id UUID UNIQUE REFERENCES public.project_documents(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,request_id)
);
CREATE INDEX project_document_requests_project_idx ON public.project_document_requests(project_id);
-- Separate metadata store: existing source_files/review/index semantics stay JS/TS only.
CREATE TABLE public.project_document_evidence (
 id UUID PRIMARY KEY,
 project_id VARCHAR(160) NOT NULL REFERENCES public.source_projects(id) ON DELETE CASCADE,
 path VARCHAR(240) NOT NULL,
 kind VARCHAR(30) NOT NULL CHECK(kind IN ('manifest','lockfile','setup','configuration-example')),
 content TEXT NOT NULL CHECK(octet_length(content)<=65536),
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 0 AND 65536),
 sha256 CHAR(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(octet_length(content)=byte_size)
);
CREATE UNIQUE INDEX project_document_evidence_path_idx ON public.project_document_evidence(project_id,lower(path));
COMMIT;
