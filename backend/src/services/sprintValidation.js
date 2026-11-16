const tasks=require('./taskValidation')
const STATUSES=Object.freeze(['Planning','Active','Completed'])
const error=(code,message,status=400)=>Object.assign(new Error(message),{code,status})
const invalid=()=>error('invalid_request','Invalid project sprint request.')
function keys(value,allowed){
 if(!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key=>!allowed.includes(key)))throw invalid()
}
function date(value){
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value<'0001-01-01' || value>'9999-12-31')throw invalid()
 const parsed=new Date(value+'T00:00:00Z')
 if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value)throw invalid()
 return value
}
function input(value,update=false){
 keys(value,update?['name','goal','startDate','endDate','status']:['projectId','name','goal','startDate','endDate','status'])
 if(update && !Object.keys(value).length)throw invalid()
 if(!update)tasks.pagination({projectId:value.projectId})
 const result={...value}
 if(!update || Object.hasOwn(value,'name')){
  if(typeof value.name!=='string' || !value.name.trim() || value.name.length>160 || /[\x00-\x1f\x7f]/.test(value.name))throw invalid()
  result.name=value.name.trim()
 }
 if(Object.hasOwn(value,'goal') && (typeof value.goal!=='string' || value.goal.length>1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.goal)))throw invalid()
 for(const key of ['startDate','endDate'])if(!update || Object.hasOwn(value,key))date(value[key])
 if(value.startDate && value.endDate && value.endDate<value.startDate)throw invalid()
 if(Object.hasOwn(value,'status') && !STATUSES.includes(value.status))throw invalid()
 return update?result:{goal:'',status:'Planning',...result}
}
function page(value,project=true){
 if(project)return tasks.pagination(value)
 keys(value,['limit','offset'])
 const {limit,offset}=tasks.pagination({projectId:'validation',...value})
 return {limit,offset}
}
module.exports={STATUSES,error,invalid,input,page,uuid:tasks.uuid,keys}
