-- Phase 1 Multi-Language Source Migration (0159)
-- Expands source_files to support 15 programming/config languages and increases max byte size to 1 MiB.
-- Preserves existing JavaScript and TypeScript records and referential integrity.
BEGIN;

SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

-- 1. Update language CHECK constraint on source_files
ALTER TABLE source_files
  DROP CONSTRAINT IF EXISTS source_files_language_check;

ALTER TABLE source_files
  ADD CONSTRAINT source_files_language_check
    CHECK (language IN (
      'JavaScript',
      'TypeScript',
      'Python',
      'Java',
      'C',
      'C++',
      'C#',
      'Go',
      'Rust',
      'PHP',
      'HTML',
      'CSS',
      'JSON',
      'YAML',
      'SQL'
    ));

-- 2. Update byte_size CHECK constraint on source_files (enlarge from 512 KiB to 1 MiB)
ALTER TABLE source_files
  DROP CONSTRAINT IF EXISTS source_files_byte_size_check;

ALTER TABLE source_files
  ADD CONSTRAINT source_files_byte_size_check
    CHECK (byte_size >= 0 AND byte_size <= 1048576);

-- 3. Update byte_count CHECK constraint on repository_review_batch_files if present
DO $$
BEGIN
  IF to_regclass('repository_review_batch_files') IS NOT NULL THEN
    ALTER TABLE repository_review_batch_files
      DROP CONSTRAINT IF EXISTS repository_review_batch_files_byte_count_check;
    ALTER TABLE repository_review_batch_files
      ADD CONSTRAINT repository_review_batch_files_byte_count_check
        CHECK (byte_count >= 0 AND byte_count <= 1048576);
  END IF;
END $$;

COMMIT;
