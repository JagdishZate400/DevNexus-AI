require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const {taskInput}=require('../src/services/taskValidation')
test('B2 assignment validates UUID/null and preserves omission through both validation passes',()=>{
 const id=crypto.randomUUID()
 for(const update of [false,true]){
  const base=update?{description:''}:{projectId:'owned',title:'Task'}
  const omitted=taskInput(taskInput(base,update),update)
  assert.equal(Object.hasOwn(omitted,'assigneeUserId'),false)
  assert.equal(taskInput({...base,assigneeUserId:null},update).assigneeUserId,null)
  assert.equal(taskInput({...base,assigneeUserId:id.toUpperCase()},update).assigneeUserId,id)
  for(const bad of ['',1,false,{},[],undefined,'person@test','00000000-0000-0000-0000-000000000000'])assert.throws(()=>taskInput({...base,assigneeUserId:bad},update),e=>e.code==='invalid_request')
 }
})
