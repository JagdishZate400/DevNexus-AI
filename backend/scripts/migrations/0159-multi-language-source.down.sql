-- Rollback Migration for 0159 Multi-Language Source
-- Restores strict JavaScript/TypeScript check and 512 KiB byte limit.
-- Enforces preflight compatibility check: fails closed if non-JS/TS or oversized records exist.
BEGIN;

SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';

DO $$
DECLARE
  incompatible_langs INTEGER := 0;
  oversized_files INTEGER := 0;
  oversized_batch_files INTEGER := 0;
BEGIN
  -- 1. Check for non-JS/TS languages in source_files
  SELECT count(*) INTO incompatible_langs
  FROM source_files
  WHERE language NOT IN ('JavaScript', 'TypeScript');

  IF incompatible_langs > 0 THEN
    RAISE EXCEPTION 'Cannot rollback 0159: % record(s) in source_files have non-JS/TS languages. Remove or migrate them before rolling back.', incompatible_langs;
  END IF;

  -- 2. Check for files exceeding 512 KiB (524288 bytes)
  SELECT count(*) INTO oversized_files
  FROM source_files
  WHERE byte_size > 524288;

  IF oversized_files > 0 THEN
    RAISE EXCEPTION 'Cannot rollback 0159: % record(s) in source_files exceed 512 KiB. Remove or resize them before rolling back.', oversized_files;
  END IF;

  -- 3. Check for batch review files exceeding 512 KiB if table exists
  IF to_regclass('repository_review_batch_files') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM repository_review_batch_files WHERE byte_count > 524288' INTO oversized_batch_files;
    IF oversized_batch_files > 0 THEN
      RAISE EXCEPTION 'Cannot rollback 0159: % record(s) in repository_review_batch_files exceed 512 KiB.', oversized_batch_files;
    END IF;
  END IF;
END $$;

-- Restore source_files constraints to 0132 baseline
ALTER TABLE source_files
  DROP CONSTRAINT IF EXISTS source_files_language_check;

ALTER TABLE source_files
  ADD CONSTRAINT source_files_language_check
    CHECK (language IN ('JavaScript', 'TypeScript'));

ALTER TABLE source_files
  DROP CONSTRAINT IF EXISTS source_files_byte_size_check;

ALTER TABLE source_files
  ADD CONSTRAINT source_files_byte_size_check
    CHECK (byte_size >= 0 AND byte_size <= 524288);

-- Restore repository_review_batch_files constraint if table exists
DO $$
BEGIN
  IF to_regclass('repository_review_batch_files') IS NOT NULL THEN
    ALTER TABLE repository_review_batch_files
      DROP CONSTRAINT IF EXISTS repository_review_batch_files_byte_count_check;
    ALTER TABLE repository_review_batch_files
      ADD CONSTRAINT repository_review_batch_files_byte_count_check
        CHECK (byte_count >= 0 AND byte_count <= 524288);
  END IF;
END $$;

COMMIT;
