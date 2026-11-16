const tasks=require('./taskValidation')
const DISPLAY_ROLES=Object.freeze(['Developer','Tester','Viewer'])
const error=(code,message,status=400)=>Object.assign(new Error(message),{code,status})
const invalid=()=>error('invalid_request','Invalid project membership request.')
function keys(value,allowed){
 if(!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key=>!allowed.includes(key)))throw invalid()
}
function input(value,update=false){
 keys(value,update?['displayRole']:['projectId','email','displayRole'])
 if(!DISPLAY_ROLES.includes(value.displayRole))throw invalid()
 if(update)return {displayRole:value.displayRole}
 tasks.pagination({projectId:value.projectId})
 if(typeof value.email!=='string' || value.email.length>254 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(value.email.trim()))throw invalid()
 return {projectId:value.projectId,email:value.email.trim().toLowerCase(),displayRole:value.displayRole}
}
const notAdded=()=>error('member_not_added','Member could not be added. Check the registered email and existing project directory.',409)
module.exports={DISPLAY_ROLES,error,invalid,input,notAdded,uuid:tasks.uuid,pagination:tasks.pagination}
