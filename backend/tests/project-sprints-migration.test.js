require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('fs')
const path=require('path')
const {applyProjectSprintsMigration}=require('../scripts/apply-project-sprints-migration')
const sql=fs.readFileSync(path.join(__dirname,'../scripts/migrations/0147-project-sprints.sql'),'utf8')
test('sprint migration is additive and preserves existing task records with same-project FK',async()=>{
 assert.match(sql,/BEGIN;/);assert.match(sql,/COMMIT;\s*$/)
 assert.doesNotMatch(sql,/DROP |UPDATE |DELETE FROM/)
 for(const value of ['REFERENCES source_projects(id)','REFERENCES users(id)','UNIQUE (id,project_id)','FOREIGN KEY (sprint_id,project_id) REFERENCES project_sprints(id,project_id)','ADD COLUMN sprint_id UUID','CHECK (end_date >= start_date)',"status IN ('Planning','Active','Completed')"])assert.ok(sql.includes(value))
 const calls=[];let released=false
 await applyProjectSprintsMigration({async connect(){return {async query(q){calls.push(q)},release(){released=true}}}})
 assert.deepEqual(calls,['SELECT 1',sql]);assert.ok(released)
})
test('sprint migration failure requests rollback and releases connection',async()=>{
 const calls=[];let released=false
 await assert.rejects(applyProjectSprintsMigration({async connect(){return {async query(q){calls.push(q);if(q===sql)throw new Error('test')},release(){released=true}}}}))
 assert.equal(calls.at(-1),'ROLLBACK');assert.ok(released)
})
