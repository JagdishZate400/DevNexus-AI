require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('fs')
const path=require('path')
const {applyProjectDocumentsMigration}=require('../scripts/apply-project-documents-migration')
const sql=fs.readFileSync(path.join(__dirname,'../scripts/migrations/0145-project-documents.sql'),'utf8')
test('additive migration has bounded schema, foreign keys and transactional application',async()=>{
  assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;\s*$/)
  assert.doesNotMatch(sql,/ALTER TABLE|UPDATE |DELETE FROM|DROP /)
  for(const expression of ['REFERENCES source_projects','REFERENCES users','jsonb_array_length(source_references) <= 200','octet_length(markdown) <= 80000','project_documents_project_history_idx']) assert.ok(sql.includes(expression))
  const calls=[];let released=false
  await applyProjectDocumentsMigration({async connect(){return {async query(q){calls.push(q)},release(){released=true}}}})
  assert.deepEqual(calls,['SELECT 1',sql]);assert.ok(released)
})
test('migration failure attempts rollback and releases connection',async()=>{
  const calls=[];let released=false
  await assert.rejects(applyProjectDocumentsMigration({async connect(){return {async query(q){calls.push(q);if(q===sql)throw new Error('test SQL failure')},release(){released=true}}}}))
  assert.equal(calls.at(-1),'ROLLBACK');assert.ok(released)
})
