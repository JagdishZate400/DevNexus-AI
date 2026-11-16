const error=(code,message,status)=>Object.assign(new Error(message),{code,status})
const invalid=()=>error('invalid_request','Select a valid persisted project.',400)
function projectQuery(input){
 if(!input||Object.keys(input).some(key=>key!=='projectId')||typeof input.projectId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(input.projectId))throw invalid()
 return input.projectId
}
module.exports={error,projectQuery,invalid}
