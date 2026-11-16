require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('fs')
const path=require('path')
const {applyProjectMembershipsMigration}=require('../scripts/apply-project-memberships-migration')
const sql=fs.readFileSync(path.join(__dirname,'../scripts/migrations/0148-project-memberships.sql'),'utf8')
test('directory migration is additive, constrained, indexed and transactional without access grants',async()=>{
 assert.match(sql,/BEGIN;/);assert.match(sql,/COMMIT;\s*$/);assert.doesNotMatch(sql,/ALTER TABLE|DROP |UPDATE |DELETE FROM|GRANT /)
 for(const part of ['REFERENCES source_projects(id)','user_id UUID NOT NULL REFERENCES users(id)','added_by UUID NOT NULL REFERENCES users(id)',"display_role IN ('Developer','Tester','Viewer')",'UNIQUE (project_id,user_id)','project_memberships_project_history_idx'])assert.ok(sql.includes(part))
 const calls=[];let released=false
 await applyProjectMembershipsMigration({async connect(){return {async query(q){calls.push(q)},release(){released=true}}}})
 assert.deepEqual(calls,['SELECT 1',sql]);assert.ok(released)
})
test('directory migration failure requests rollback and releases connection',async()=>{
 const calls=[];let released=false
 await assert.rejects(applyProjectMembershipsMigration({async connect(){return {async query(q){calls.push(q);if(q===sql)throw new Error('test')},release(){released=true}}}}))
 assert.equal(calls.at(-1),'ROLLBACK');assert.ok(released)
})
