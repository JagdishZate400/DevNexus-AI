const base=require('./taskCommentValidation')
const error=base.error
const invalid=()=>error('invalid_request','Invalid task activity request.')
const uid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const position=value=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n
const reasons={task_created:['task_created'],status_changed:['task_updated','unknown'],assignment_changed:['task_updated','membership_removed','owner_changed','unknown'],sprint_changed:['sprint_link_changed','unknown']}
function uuid(value){try{return base.uuid(value)}catch{throw invalid()}}
function cursor(taskId,before){return Buffer.from(JSON.stringify({v:1,taskId,stream:'activity',before})).toString('base64url')}
function pagination(taskId,value){
 try{
  base.keys(value,['limit','before']);let before=null
  if(value.before!==undefined){
   if(typeof value.before!=='string'||value.before.length>512||! /^[A-Za-z0-9_-]+$/.test(value.before))throw invalid()
   const bytes=Buffer.from(value.before,'base64url');if(bytes.toString('base64url')!==value.before)throw invalid()
   const p=JSON.parse(bytes.toString('utf8'));base.keys(p,['v','taskId','stream','before'])
   if(p.v!==1||p.taskId!==taskId||p.stream!=='activity'||!position(p.before))throw invalid();before=p.before
  }
  return {limit:base.pagination(taskId,value.limit===undefined?{}:{limit:value.limit}).limit,before}
 }catch{throw invalid()}
}
function record(value,taskId){
 const bad=()=>{throw Error('Invalid task activity response')}
 if(!value||Object.keys(value).sort().join(',')!=='actor,changes,correlationId,eventType,id,occurredAt,origin,reason,taskId'||!position(value.id)||value.taskId!==taskId||!uid(taskId)||!Object.hasOwn(reasons,value.eventType)||!reasons[value.eventType].includes(value.reason)||!['api','database'].includes(value.origin)||typeof value.occurredAt!=='string'||!Number.isFinite(Date.parse(value.occurredAt))||new Date(value.occurredAt).toISOString()!==value.occurredAt||!(value.correlationId===null||uid(value.correlationId)))bad()
 if(value.actor!==null && (!value.actor||Object.keys(value.actor).sort().join(',')!=='displayName,userId'||!(value.actor.userId===null||uid(value.actor.userId))||typeof value.actor.displayName!=='string'||!value.actor.displayName.trim()||Array.from(value.actor.displayName).length>150))bad()
 const c=value.changes
 if(!c||typeof c!=='object'||Array.isArray(c)||c.version!==1||Buffer.byteLength(JSON.stringify(c))>8192)bad()
 const statuses=['To Do','In Progress','Done'],nullableId=x=>x===null||uid(x)
 if(value.eventType==='task_created'){
  if(Object.keys(c).sort().join(',')!=='initial,version'||!c.initial||Object.keys(c.initial).sort().join(',')!=='assigneeUserId,sprintId,status'||!statuses.includes(c.initial.status)||!nullableId(c.initial.assigneeUserId)||!nullableId(c.initial.sprintId))bad()
 }else{
  if(Object.keys(c).sort().join(',')!=='from,to,version'||c.from===c.to)bad()
  if(value.eventType==='status_changed'?!statuses.includes(c.from)||!statuses.includes(c.to):!nullableId(c.from)||!nullableId(c.to))bad()
  if(['membership_removed','owner_changed'].includes(value.reason)&&c.to!==null)bad()
 }
 return value
}
function page(value,taskId,limit){
 if(!value||Object.keys(value).sort().join(',')!=='activity,hasMore,limit,nextCursor,taskId'||value.taskId!==taskId||value.limit!==limit||!Array.isArray(value.activity)||value.activity.length>limit||typeof value.hasMore!=='boolean'||(value.hasMore?(value.activity.length!==limit||typeof value.nextCursor!=='string'):value.nextCursor!==null))throw Error('Invalid task activity response')
 value.activity.forEach(item=>record(item,taskId))
 if(new Set(value.activity.map(x=>x.id)).size!==value.activity.length||value.activity.some((x,i)=>i>0&&BigInt(x.id)>=BigInt(value.activity[i-1].id)))throw Error('Invalid task activity order')
 if(value.hasMore&&value.nextCursor!==cursor(taskId,value.activity.at(-1).id))throw Error('Invalid task activity cursor')
 return value
}
module.exports={error,invalid,uuid,cursor,pagination,record,page}
