-- D2.2.1: explicit application only. Constraint names verified in development pg_constraint.
-- Preserve existing rows, keys, foreign keys, indexes and lease/status constraints.
BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';
ALTER TABLE repository_review_batches
  DROP CONSTRAINT repository_review_batches_scope_check,
  ADD CONSTRAINT repository_review_batches_scope_check
    CHECK (scope IN ('Selected Files','Entire Project'));
ALTER TABLE repository_review_batch_files
  DROP CONSTRAINT repository_review_batch_files_ordinal_check,
  ADD CONSTRAINT repository_review_batch_files_ordinal_check
    CHECK (ordinal BETWEEN 0 AND 199);
COMMIT;
