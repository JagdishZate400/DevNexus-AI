const tasks=require('./taskValidation')
const error=(code,message,status=400)=>Object.assign(new Error(message),{code,status})
const invalid=()=>error('invalid_request','Invalid task comment request.')
function keys(value,allowed){
 if(!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key=>!allowed.includes(key)))throw invalid()
}
function uuid(value){try{return tasks.uuid(value).toLowerCase()}catch{throw invalid()}}
function input(value){
 keys(value,['body','clientRequestId'])
 if(typeof value.body!=='string')throw invalid()
 const body=value.body.replace(/\r\n?/g,'\n'),characters=Array.from(body)
 if(!body.trim() || characters.length>4000 || characters.some(char=>{const n=char.codePointAt(0);return n===0 || (n>=0xd800&&n<=0xdfff)}))throw invalid()
 return {body,clientRequestId:uuid(value.clientRequestId)}
}
function cursor(taskId,before){return Buffer.from(JSON.stringify({v:1,taskId,stream:'comments',before})).toString('base64url')}
function pagination(taskId,value){
 keys(value,['limit','before'])
 const limit=value.limit===undefined?20:value.limit
 if(typeof limit!=='number' && (typeof limit!=='string'||! /^[1-9][0-9]?$/.test(limit)))throw invalid()
 const size=Number(limit);if(!Number.isInteger(size)||size<1||size>50)throw invalid()
 let before=null
 if(value.before!==undefined){
  if(typeof value.before!=='string'||value.before.length>512||! /^[A-Za-z0-9_-]+$/.test(value.before))throw invalid()
  try{
   const bytes=Buffer.from(value.before,'base64url');if(bytes.toString('base64url')!==value.before)throw invalid()
   const parsed=JSON.parse(bytes.toString('utf8'));keys(parsed,['v','taskId','stream','before'])
   if(parsed.v!==1||parsed.taskId!==taskId||parsed.stream!=='comments'||typeof parsed.before!=='string'||! /^[1-9][0-9]{0,18}$/.test(parsed.before)||BigInt(parsed.before)>9223372036854775807n)throw invalid()
   before=parsed.before
  }catch{throw invalid()}
 }
 return {limit:size,before}
}
module.exports={error,invalid,keys,uuid,input,cursor,pagination}
