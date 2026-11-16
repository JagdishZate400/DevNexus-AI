const STATUSES = Object.freeze(['To Do','In Progress','Done'])
const PRIORITIES = Object.freeze(['Low','Medium','High'])
function taskError(code,message,status=400){return Object.assign(new Error(message),{code,status})}
const invalid=()=>taskError('invalid_request','Invalid project task request.',400)
function keys(value,allowed){
  if(!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key=>!allowed.includes(key)))throw invalid()
}
function uuid(value){if(typeof value!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw invalid();return value}
function projectId(value){if(typeof value!=='string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value))throw invalid();return value}
function taskInput(value,update=false){
  keys(value,update ? ['title','description','status','priority','assigneeUserId'] : ['projectId','title','description','status','priority','assigneeUserId'])
  if(!update)projectId(value.projectId)
  if(update && !Object.keys(value).length)throw invalid()
  const result={...value}
  if(Object.hasOwn(value,'assigneeUserId') && value.assigneeUserId!==null)result.assigneeUserId=uuid(value.assigneeUserId).toLowerCase()
  if(!update || Object.hasOwn(value,'title')){
    if(typeof value.title!=='string' || !value.title.trim() || value.title.length>200 || /[\x00-\x1f\x7f]/.test(value.title))throw invalid()
    result.title=value.title.trim()
  }
  if(Object.hasOwn(value,'description') && (typeof value.description!=='string' || value.description.length>2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.description)))throw invalid()
  if(Object.hasOwn(value,'status') && !STATUSES.includes(value.status))throw invalid()
  if(Object.hasOwn(value,'priority') && !PRIORITIES.includes(value.priority))throw invalid()
  return update ? result : {description:'',status:'To Do',priority:'Medium',...result}
}
function pagination(value){
  keys(value,['projectId','limit','offset']);projectId(value.projectId)
  function integer(value,fallback,max){if(value===undefined)return fallback;if(typeof value!=='string' || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max)throw invalid();return Number(value)}
  const limit=integer(value.limit,20,50),offset=integer(value.offset,0,100000)
  if(!limit)throw invalid()
  return {projectId:value.projectId,limit,offset}
}
module.exports={STATUSES,PRIORITIES,taskError,invalid,uuid,taskInput,pagination}
