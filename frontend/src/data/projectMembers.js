export const displayRoles=['Developer','Tester','Viewer']
export function validateTeamProjects(data,userId){
 if(!data||!Array.isArray(data.projects)||data.projects.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||typeof p.ownerId!=='string'||!p.ownerId||!['owner','member'].includes(p.access)||(p.access==='owner')!==(p.ownerId===userId))||new Set(data.projects.map(p=>p.id)).size!==data.projects.length)throw new Error('Invalid Team project response.')
 return data.projects
}
const person=value=>value && typeof value.userId==='string' && !!value.userId && typeof value.displayName==='string' && typeof value.email==='string'
export function validateDirectory(data,projectId,offset,ownerId){
 if(!data || data.projectId!==projectId || !person(data.owner) || (ownerId && data.owner.userId!==ownerId) || !Array.isArray(data.members) || data.members.length>20 || !Number.isSafeInteger(data.total) || data.total<0 || data.limit!==20 || data.offset!==offset || (data.members.length>0 && offset+data.members.length>data.total))throw new Error('Invalid project membership response.')
 if(data.members.some(member=>!person(member) || typeof member.id!=='string' || !member.id || member.projectId!==projectId || member.userId===data.owner.userId || !displayRoles.includes(member.displayRole)) || new Set(data.members.map(member=>member.id)).size!==data.members.length || new Set(data.members.map(member=>member.userId)).size!==data.members.length)throw new Error('Invalid project membership response.')
 return data
}
export function formatMembershipError(error){
 if(!error)return {message:'',isRateLimit:false}
 const isRateLimit=error.status===429 || error.data?.code==='member_add_rate_limited'
 if(isRateLimit){
  return {
   message:'Too many member additions. Member additions are limited to 10 attempts per 15-minute window. Please wait for the cooldown window to expire before retrying.',
   isRateLimit:true
  }
 }
 const base=error.status?error.message:'The change may have been saved. No automatic retry was made. Refresh the directory and review the saved result before submitting again.'
 return {
  message:`${base} Refresh the directory, then retry the action.`,
  isRateLimit:false
 }
}

