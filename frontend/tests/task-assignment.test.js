import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateProjectTask} from '../src/data/projectTasks.js'
import {mergeAssigneePage} from '../src/data/taskAssignees.js'
const ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const person=i=>({userId:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,displayName:'Same name',email:`person${i}@test`})
const page=(offset=0,total=21)=>({projectId:'owned',owner:{userId:ownerId,displayName:'Owner',email:'owner@test'},members:Array.from({length:Math.min(20,total-offset)},(_,i)=>({...person(offset+i+1),id:`member-${offset+i}`,projectId:'owned',displayRole:['Developer','Tester','Viewer'][i%3]})),total,limit:20,offset})
const task={id:'task',projectId:'owned',title:'Task',description:'',status:'To Do',priority:'Medium',sprintId:null,assigneeUserId:null,assignee:null}
test('canonical assignment validator accepts assigned/unassigned and rejects mismatched identity',()=>{
 assert.equal(validateProjectTask(task,'owned'),task)
 assert.ok(validateProjectTask({...task,assigneeUserId:person(1).userId,assignee:person(1)},'owned'))
 for(const patch of [{sprintId:undefined},{sprintId:'demo'},{assigneeUserId:undefined},{assignee:undefined},{assigneeUserId:'email@test'},{assignee:person(1)},{assigneeUserId:person(1).userId,assignee:person(2)},{assigneeUserId:person(1).userId,assignee:{...person(1),email:null}}])assert.throws(()=>validateProjectTask({...task,...patch},'owned'))
})
test('directory merges all pages with distinct UUIDs even when display names match',()=>{
 const first=mergeAssigneePage(null,page(),'owned',0,ownerId)
 const all=mergeAssigneePage(first,page(20),'owned',20,ownerId)
 assert.equal(all.members.length,21);assert.equal(all.members[20].email,'person21@test')
 assert.equal(mergeAssigneePage(null,page(0,0),'owned',0,ownerId).members.length,0)
})
test('directory rejects other owners/projects, malformed identities and inconsistent pagination',()=>{
 const first=mergeAssigneePage(null,page(),'owned',0,ownerId)
 for(const bad of [{...page(),projectId:'foreign'},{...page(),owner:person(50)},{...page(),members:[]},{...page(),members:[{...page().members[0],userId:'email@test'},...page().members.slice(1)]}])assert.throws(()=>mergeAssigneePage(null,bad,'owned',0,ownerId))
 assert.throws(()=>mergeAssigneePage(first,page(20,22),'owned',20,ownerId))
 assert.throws(()=>mergeAssigneePage(first,{...page(20),members:[page().members[0]]},'owned',20,ownerId))
})
