-- Additive E2.1 classification. No historical backfill or new analysis table.
BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';
ALTER TABLE repository_review_findings
  ADD COLUMN finding_type VARCHAR(10),
  ADD CONSTRAINT repository_review_findings_finding_type_check
    CHECK (finding_type IS NULL OR finding_type IN ('Bug','Security'));
COMMIT;
