require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { REVIEW_SCOPES, REVIEW_SCOPE_LIMITS, parseReviewScope } = require('../src/services/reviewScope')
const { applyReviewScopeMigration } = require('../scripts/apply-review-scope-migration')

test('scope contract recognizes both scopes, defaults only missing scope, and retains selected limits', () => {
  assert.equal(parseReviewScope(), 'Selected Files')
  assert.equal(parseReviewScope('Selected Files'), REVIEW_SCOPES.selected)
  assert.equal(parseReviewScope('Entire Project'), REVIEW_SCOPES.project)
  assert.deepEqual(REVIEW_SCOPE_LIMITS[REVIEW_SCOPES.selected], { minFiles: 1, maxFiles: 3, maxOrdinal: 2 })
  assert.deepEqual(REVIEW_SCOPE_LIMITS[REVIEW_SCOPES.project], { minFiles: 1, maxFiles: 200, maxOrdinal: 199 })
  assert.ok(Object.isFrozen(REVIEW_SCOPE_LIMITS) && Object.isFrozen(REVIEW_SCOPE_LIMITS[REVIEW_SCOPES.project]))
})
test('invalid scopes are rejected without implicit trimming, case conversion or coercion', () => {
  for (const value of [null, '', 'Folder', 'selected files', ' Entire Project ', 1, {}, ['Selected Files']]) assert.throws(() => parseReviewScope(value), (e) => e.code === 'invalid_review_scope' && e.status === 400)
})
test('migration only replaces the two discovered checks, preserves keys/FKs, and declares correct ordinal boundaries', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../scripts/migrations/0143-review-scope-foundation.sql'), 'utf8')
  assert.match(sql, /BEGIN;/)
  assert.match(sql, /COMMIT;/)
  assert.match(sql, /CHECK \(scope IN \('Selected Files','Entire Project'\)\)/)
  assert.match(sql, /CHECK \(ordinal BETWEEN 0 AND 199\)/)
  assert.deepEqual([...sql.matchAll(/DROP CONSTRAINT (\w+)/g)].map((m) => m[1]), ['repository_review_batches_scope_check', 'repository_review_batch_files_ordinal_check'])
  assert.deepEqual([...sql.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]), ['repository_review_batches_scope_check', 'repository_review_batch_files_ordinal_check'])
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b|DROP\s+(?:TABLE|COLUMN)|DROP CONSTRAINT.*(?:pkey|fkey|ordinal_key)/i)
  assert.match(sql, /SET LOCAL lock_timeout/)
})
test('explicit application verifies connectivity and releases connection without logging credentials', async () => {
  const calls = []; let released = false
  const client = { async query(sql) { calls.push(sql); return { rows: [] } }, release() { released = true } }
  await applyReviewScopeMigration({ async connect() { return client } })
  assert.equal(calls[0], 'SELECT 1')
  assert.match(calls[1], /BEGIN;[\s\S]*COMMIT;/)
  assert.equal(released, true)
})
test('application failure explicitly rolls back and releases connection', async () => {
  const calls = []; let released = false
  const client = { async query(sql) { calls.push(sql); if (sql !== 'SELECT 1' && sql !== 'ROLLBACK') throw Object.assign(new Error('private database detail'), { code: '55P03' }) }, release() { released = true } }
  await assert.rejects(applyReviewScopeMigration({ async connect() { return client } }), (e) => e.code === '55P03')
  assert.equal(calls.at(-1), 'ROLLBACK')
  assert.equal(released, true)
})
