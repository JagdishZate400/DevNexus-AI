-- Phase A must be applied first. No automatic schema changes at runtime.
BEGIN;
CREATE TABLE IF NOT EXISTS source_file_indexes (
  file_id UUID PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
  source_sha256 CHAR(64) NOT NULL,
  index_version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('indexed', 'excluded')),
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS source_chunks (
  id BIGSERIAL PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  start_line INTEGER NOT NULL CHECK (start_line > 0),
  end_line INTEGER NOT NULL CHECK (end_line >= start_line AND end_line - start_line < 80),
  start_column INTEGER NOT NULL CHECK (start_column > 0),
  end_column INTEGER NOT NULL CHECK (end_column > 0),
  content TEXT NOT NULL CHECK (octet_length(content) <= 8000),
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content)) STORED,
  UNIQUE(file_id, ordinal)
);
CREATE INDEX IF NOT EXISTS source_chunks_search_idx ON source_chunks USING GIN(search_vector);
COMMIT;
