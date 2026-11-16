const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const position=value=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',')
const bad=()=>{throw new Error('Invalid task collaboration response.')}
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value
const person=value=>exact(value,['userId','displayName'])&&(value.userId===null||uuid(value.userId))&&typeof value.displayName==='string'&&!!value.displayName.trim()&&Array.from(value.displayName).length<=150
export const normalizeComment=body=>body.replace(/\r\n?/g,'\n')
export function commentInput(body){
 if(typeof body!=='string')return 'Enter a comment.'
 const text=normalizeComment(body),chars=Array.from(text)
 if(!text.trim())return 'Enter a comment before submitting.'
 if(chars.length>4000)return 'Comments must be 4,000 characters or fewer.'
 if(chars.some(c=>{const n=c.codePointAt(0);return n===0||(n>=0xd800&&n<=0xdfff)}))return 'Remove unsupported characters from your comment.'
 return ''
}
export function collaborationCursor(taskId,stream,before){return btoa(JSON.stringify({v:1,taskId,stream,before})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
export function validateCursor(value,taskId,stream){
 try{
  if(typeof value!=='string'||value.length>512||! /^[A-Za-z0-9_-]+$/.test(value))bad()
  const decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/'))
  const c=JSON.parse(decoded)
  if(!exact(c,['v','taskId','stream','before'])||c.v!==1||c.taskId!==taskId||c.stream!==stream||!position(c.before)||collaborationCursor(taskId,stream,c.before)!==value)bad()
  return c.before
 }catch{bad()}
}
export function validateComment(value,taskId){
 if(!exact(value,['id','taskId','author','body','createdAt','position','clientRequestId'])||!uuid(value.id)||value.taskId!==taskId||!uuid(taskId)||!person(value.author)||commentInput(value.body)||!iso(value.createdAt)||!position(value.position)||!uuid(value.clientRequestId))bad()
 return value
}
const reasons={task_created:['task_created'],status_changed:['task_updated','unknown'],assignment_changed:['task_updated','membership_removed','owner_changed','unknown'],sprint_changed:['sprint_link_changed','unknown']}
const statuses=['To Do','In Progress','Done'],nullableId=value=>value===null||uuid(value)
export function validateActivity(value,taskId){
 if(!exact(value,['id','taskId','actor','eventType','origin','reason','changes','occurredAt','correlationId'])||!position(value.id)||value.taskId!==taskId||!uuid(taskId)||!(value.actor===null||person(value.actor))||!Object.hasOwn(reasons,value.eventType)||!reasons[value.eventType].includes(value.reason)||!['api','database'].includes(value.origin)||!iso(value.occurredAt)||!nullableId(value.correlationId))bad()
 const c=value.changes
 if(!c||c.version!==1||new TextEncoder().encode(JSON.stringify(c)).length>8192)bad()
 if(value.eventType==='task_created'){
  if(!exact(c,['version','initial'])||!exact(c.initial,['status','assigneeUserId','sprintId'])||!statuses.includes(c.initial.status)||!nullableId(c.initial.assigneeUserId)||!nullableId(c.initial.sprintId))bad()
 }else{
  if(!exact(c,['version','from','to'])||c.from===c.to)bad()
  if(value.eventType==='status_changed'?!statuses.includes(c.from)||!statuses.includes(c.to):!nullableId(c.from)||!nullableId(c.to))bad()
  if(['membership_removed','owner_changed'].includes(value.reason)&&c.to!==null)bad()
 }
 return value
}
export function validateCollaborationPage(value,taskId,stream,before=null){
 const key=stream==='comments'?'comments':'activity',order=stream==='comments'?'position':'id'
 if(!['comments','activity'].includes(stream)||!exact(value,['taskId',key,'limit','nextCursor','hasMore'])||value.taskId!==taskId||value.limit!==20||!Array.isArray(value[key])||value[key].length>20||typeof value.hasMore!=='boolean')bad()
 value[key].forEach(item=>(stream==='comments'?validateComment:validateActivity)(item,taskId))
 if(new Set(value[key].map(x=>x.id)).size!==value[key].length||new Set(value[key].map(x=>x[order])).size!==value[key].length||value[key].some((x,i)=>(before&&BigInt(x[order])>=BigInt(before))||(i>0&&BigInt(x[order])>=BigInt(value[key][i-1][order]))))bad()
 if(value.hasMore){if(value[key].length!==20||validateCursor(value.nextCursor,taskId,stream)!==value[key].at(-1)[order])bad()}
 else if(value.nextCursor!==null)bad()
 return value
}
export function mergeCollaboration(items,added,stream){
 const order=stream==='comments'?'position':'id',map=new Map(items.map(x=>[x.id,x]))
 for(const item of added){if(map.has(item.id)&&JSON.stringify(map.get(item.id))!==JSON.stringify(item))bad();map.set(item.id,item)}
 return [...map.values()].sort((a,b)=>BigInt(a[order])>BigInt(b[order])?-1:1)
}
const reference=(value,label)=>value===null?`No ${label.toLowerCase()}`:`${label} ${value}`
export function activityDescription(event){
 const c=event.changes
 if(event.eventType==='task_created')return `Task created with status ${c.initial.status}.`
 if(event.eventType==='status_changed')return `Status changed from ${c.from} to ${c.to}.`
 if(event.eventType==='sprint_changed')return `Sprint changed from ${reference(c.from,'Sprint')} to ${reference(c.to,'Sprint')}.`
 const cause=event.reason==='membership_removed'?' after membership removal':event.reason==='owner_changed'?' after project ownership changed':''
 return c.to===null?`Assignment cleared${cause}. Previous assignee: ${reference(c.from,'User')}.`:`Assignee changed from ${reference(c.from,'User')} to ${reference(c.to,'User')}.`
}
