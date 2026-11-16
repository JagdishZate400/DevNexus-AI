export const sprintStatuses=['Planning','Active','Completed']
export function validateSprint(sprint,projectId,id){
 const c=sprint?.counts
 if(!sprint || typeof sprint.id!=='string' || sprint.projectId!==projectId || (id && sprint.id!==id) || typeof sprint.name!=='string' || typeof sprint.goal!=='string' || !sprintStatuses.includes(sprint.status) || !/^\d{4}-\d{2}-\d{2}$/.test(sprint.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(sprint.endDate) || !c || ['toDo','inProgress','done','total'].some(key=>!Number.isSafeInteger(c[key]) || c[key]<0) || c.total!==c.toDo+c.inProgress+c.done || sprint.empty!==(c.total===0) || (c.total===0 ? sprint.progress!==null : !Number.isFinite(sprint.progress) || sprint.progress<0 || sprint.progress>100))throw new Error('Invalid or cross-project sprint response.')
 return sprint
}
export function validateSprintPage(data,projectId,offset){
 if(!data || !Array.isArray(data.sprints) || data.sprints.length>20 || !Number.isSafeInteger(data.total) || data.total<0 || data.limit!==20 || data.offset!==offset || (data.sprints.length>0 && offset+data.sprints.length>data.total) || new Set(data.sprints.map(s=>s?.id)).size!==data.sprints.length)throw new Error('Invalid sprint listing response.')
 data.sprints.forEach(s=>validateSprint(s,projectId));return data
}
export function sprintError(error){return error.status?error.message:'Sprint request failed or its outcome is uncertain. Refresh before retrying; a change may have been saved.'}
