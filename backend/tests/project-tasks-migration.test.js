require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('fs')
const path=require('path')
const {applyProjectTasksMigration}=require('../scripts/apply-project-tasks-migration')
const sql=fs.readFileSync(path.join(__dirname,'../scripts/migrations/0146-project-tasks.sql'),'utf8')
test('task migration is additive, constrained, indexed and applied in one transaction',async()=>{
 assert.match(sql,/BEGIN;/);assert.match(sql,/COMMIT;\s*$/);assert.doesNotMatch(sql,/ALTER TABLE|DROP |UPDATE |DELETE FROM/)
 for(const value of ['REFERENCES source_projects(id)','REFERENCES users(id)',"status IN ('To Do','In Progress','Done')","priority IN ('Low','Medium','High')",'project_tasks_project_history_idx'])assert.ok(sql.includes(value))
 const calls=[];let released=false
 await applyProjectTasksMigration({async connect(){return {async query(sql){calls.push(sql)},release(){released=true}}}})
 assert.deepEqual(calls,['SELECT 1',sql]);assert.ok(released)
})
test('migration error rolls back and releases connection',async()=>{
 const calls=[];let released=false
 await assert.rejects(applyProjectTasksMigration({async connect(){return {async query(query){calls.push(query);if(query===sql)throw new Error('test SQL failure')},release(){released=true}}}}))
 assert.equal(calls.at(-1),'ROLLBACK');assert.ok(released)
})
