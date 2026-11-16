require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('fs')
const path=require('path')
const {taskProjection}=require('../src/db/taskProjection')
const {taskInput}=require('../src/services/taskValidation')

test('B1 migration adds nullable FK and indexes without rewriting records or other FKs',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../scripts/migrations/0152-task-assignment.sql'),'utf8')
 assert.match(sql,/BEGIN;/);assert.match(sql,/COMMIT;\s*$/)
 assert.match(sql,/ADD COLUMN assignee_user_id UUID;/)
 assert.match(sql,/FOREIGN KEY \(assignee_user_id\) REFERENCES users\(id\) ON DELETE SET NULL/)
 assert.equal((sql.match(/CREATE INDEX/g)||[]).length,2)
 assert.doesNotMatch(sql,/\b(DEFAULT|UPDATE|INSERT|TRIGGER|DROP)\b/)
})

test('shared SQL projection exposes nullable assignment and sprint identity with only directory fields',()=>{
 for(const alias of ['project_tasks','t']){
  const sql=taskProjection(alias)
  assert.ok(sql.includes(`${alias}.sprint_id AS "sprintId"`))
  assert.ok(sql.includes(`${alias}.assignee_user_id AS "assigneeUserId"`))
  assert.ok(sql.includes(`u.id=${alias}.assignee_user_id`))
  assert.match(sql,/json_build_object\('userId',u.id,'displayName',u.full_name,'email',u.email\)/)
  assert.doesNotMatch(sql,/password|token|role/)
 }
})

test('POST and PATCH reject forged identity and sprint fields',()=>{
 for(const update of [false,true])for(const key of ['assignee','assignee_user_id','sprintId','assigneeEmail','displayName','email','userId'])for(const value of [null,'someone']){
  assert.throws(()=>taskInput({...(!update?{projectId:'owned'}:{}),title:'Task',[key]:value},update),e=>e.code==='invalid_request')
 }
})

