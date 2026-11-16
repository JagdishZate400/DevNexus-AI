const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const EXPECTED_LANGUAGES = [
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
  'SQL',
]

test('0159 migration contains bounded transactions, timeouts, and all 15 target languages', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../scripts/migrations/0159-multi-language-source.sql'), 'utf8')

  assert.match(sql, /^BEGIN;/m, 'Migration must begin with explicit transaction')
  assert.match(sql, /COMMIT;\s*$/m, 'Migration must commit explicitly')
  assert.match(sql, /SET LOCAL lock_timeout\s*=\s*'5000ms'/i, 'Must bound lock acquisitions to 5s')
  assert.match(sql, /SET LOCAL statement_timeout\s*=\s*'30000ms'/i, 'Must bound statement executions to 30s')

  for (const lang of EXPECTED_LANGUAGES) {
    assert.ok(sql.includes(`'${lang}'`), `Migration must include language: ${lang}`)
  }

  assert.match(sql, /byte_size\s*>=\s*0\s+AND\s+byte_size\s*<=\s*1048576/i, 'Must set byte_size upper bound to 1 MiB (1048576 bytes)')
  assert.match(sql, /byte_count\s*>=\s*0\s+AND\s+byte_count\s*<=\s*1048576/i, 'Must update repository_review_batch_files byte_count if present')
})

test('0159 down migration enforces preflight compatibility checks and restores 0132 baseline', () => {
  const downSql = fs.readFileSync(path.join(__dirname, '../scripts/migrations/0159-multi-language-source.down.sql'), 'utf8')

  assert.match(downSql, /^BEGIN;/m, 'Rollback must begin with explicit transaction')
  assert.match(downSql, /COMMIT;\s*$/m, 'Rollback must commit explicitly')
  assert.match(downSql, /SET LOCAL lock_timeout\s*=\s*'5000ms'/i, 'Must bound lock acquisitions to 5s')

  assert.match(downSql, /language NOT IN \('JavaScript', 'TypeScript'\)/, 'Must check for incompatible languages before rollback')
  assert.match(downSql, /byte_size > 524288/, 'Must check for oversized files before rollback')
  assert.match(downSql, /RAISE EXCEPTION/, 'Must raise exception if incompatible rows exist')

  assert.match(downSql, /CHECK\s*\(language\s+IN\s+\('JavaScript',\s*'TypeScript'\)\)/i, 'Must restore JS/TS constraint')
  assert.match(downSql, /CHECK\s*\(byte_size\s*>=\s*0\s+AND\s+byte_size\s*<=\s*524288\)/i, 'Must restore 512 KiB constraint')
})
