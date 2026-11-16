import test from 'node:test'
import assert from 'node:assert/strict'
import {commentInput,normalizeComment,validateComment,validateActivity,validateCollaborationPage,collaborationCursor,validateCursor,mergeCollaboration,activityDescription} from '../src/data/taskCollaboration.js'
const taskId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222'
const comment={id,taskId,author:{userId:id,displayName:'Owner'},body:'<script>alert(1)</script>',createdAt:'2026-10-16T00:00:00.000Z',position:'9007199254740993',clientRequestId:id}
const event={id:'9007199254740993',taskId,actor:null,eventType:'assignment_changed',origin:'database',reason:'membership_removed',changes:{version:1,from:id,to:null},occurredAt:comment.createdAt,correlationId:null}
test('comment validation counts Unicode points and normalizes only newlines',()=>{
 assert.equal(commentInput('\u{1f600}'.repeat(4000)),'');assert.match(commentInput('\u{1f600}'.repeat(4001)),/4,000/)
 for(const body of ['  ','\0','\ud800'])assert.ok(commentInput(body))
 assert.equal(normalizeComment(' a\r\nb\rc '),' a\nb\nc ')
 assert.equal(validateComment(comment,taskId).body,comment.body)
 for(const patch of [{author:{...comment.author,email:'private'}},{position:1},{taskId:id},{createdAt:'yesterday'},{extra:true}])assert.throws(()=>validateComment({...comment,...patch},taskId))
})
test('cursors enforce task, stream, canonical encoding and BIGINT range',()=>{
 const cursor=collaborationCursor(taskId,'comments',comment.position)
 assert.equal(validateCursor(cursor,taskId,'comments'),comment.position)
 for(const args of [[cursor,id,'comments'],[cursor,taskId,'activity'],[cursor+'=',taskId,'comments'],[collaborationCursor(taskId,'comments','9223372036854775808'),taskId,'comments']])assert.throws(()=>validateCursor(...args))
})
test('pages enforce numeric descending order, boundaries, exact envelopes and cursor agreement',()=>{
 const comments=Array.from({length:20},(_,i)=>({...comment,id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,position:String(30-i)}))
 const page={taskId,comments,limit:20,hasMore:true,nextCursor:collaborationCursor(taskId,'comments','11')}
 assert.equal(validateCollaborationPage(page,taskId,'comments'),page)
 for(const patch of [{comments:[...comments].reverse()},{limit:50},{nextCursor:collaborationCursor(taskId,'comments','12')},{comments:comments.slice(1)},{extra:true}])assert.throws(()=>validateCollaborationPage({...page,...patch},taskId,'comments'))
 assert.throws(()=>validateCollaborationPage(page,taskId,'comments','20'))
 assert.equal(mergeCollaboration([comment],[comment],'comments').length,1)
 assert.throws(()=>mergeCollaboration([comment],[{...comment,body:'changed'}],'comments'))
})
test('activity validates all change types and preserves system attribution without inventing history',()=>{
 assert.equal(validateActivity(event,taskId),event);assert.match(activityDescription(event),/membership removal/)
 for(const [eventType,reason,changes] of [['task_created','task_created',{version:1,initial:{status:'To Do',assigneeUserId:null,sprintId:null}}],['status_changed','task_updated',{version:1,from:'To Do',to:'Done'}],['sprint_changed','sprint_link_changed',{version:1,from:null,to:id}]])assert.ok(activityDescription(validateActivity({...event,eventType,reason,changes},taskId)))
 assert.throws(()=>validateActivity({...event,changes:{version:1,from:null,to:id}},taskId))
 assert.equal(validateCollaborationPage({taskId,activity:[],limit:20,nextCursor:null,hasMore:false},taskId,'activity').activity.length,0)
})

