// Durable API enums intentionally differ from legacy taskStatuses ('Todo').
export const projectTaskStatuses = ['To Do','In Progress','Done']
export const projectTaskPriorities = ['Low','Medium','High']
export const isUserUuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export function validateTaskAssignment(task){
  if(!task || !(task.sprintId===null || isUserUuid(task.sprintId)) || !(task.assigneeUserId===null || isUserUuid(task.assigneeUserId)))throw new Error('Invalid task assignment response.')
  const person=task.assignee
  if(task.assigneeUserId===null ? person!==null : !person || person.userId!==task.assigneeUserId || typeof person.displayName!=='string' || !person.displayName.trim() || typeof person.email!=='string' || !person.email.trim())throw new Error('Invalid task assignee identity.')
  return task
}
export function validateProjectTask(task,projectId,id) {
  if(!task || typeof task.id!=='string' || task.projectId!==projectId || (id && task.id!==id) || typeof task.title!=='string' || typeof task.description!=='string' || !projectTaskStatuses.includes(task.status) || !projectTaskPriorities.includes(task.priority))throw new Error('Invalid or cross-project task response.')
  return validateTaskAssignment(task)
}
export function validateProjectTaskPage(data,projectId,offset) {
  if(!data || !Array.isArray(data.tasks) || data.tasks.length>20 || !Number.isSafeInteger(data.total) || data.total<0 || (data.tasks.length>0 && offset+data.tasks.length>data.total) || data.limit!==20 || data.offset!==offset || new Set(data.tasks.map(task=>task?.id)).size!==data.tasks.length)throw new Error('Invalid task listing response.')
  data.tasks.forEach(task=>validateProjectTask(task,projectId))
  return data
}
