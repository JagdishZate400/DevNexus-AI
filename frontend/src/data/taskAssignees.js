import {validateDirectory} from './projectMembers.js'
import {isUserUuid} from './projectTasks.js'

// Keep each page scoped to the authenticated project owner. Never merge overlapping snapshots.
export function mergeAssigneePage(previous,data,projectId,offset,ownerId){
 if(!isUserUuid(ownerId))throw new Error('Sign in again to load assignees.')
 validateDirectory(data,projectId,offset,ownerId)
 for(const person of [data.owner,...data.members])if(!isUserUuid(person.userId) || !person.displayName.trim() || !person.email.trim())throw new Error('Invalid assignee directory response.')
 if(data.members.length!==Math.min(20,Math.max(0,data.total-offset)))throw new Error('The project directory changed. Refresh assignees.')
 if(offset && (!previous || previous.members.length!==offset || previous.total!==data.total || JSON.stringify(previous.owner)!==JSON.stringify(data.owner)))throw new Error('The project directory changed. Refresh assignees.')
 const members=[...(offset?previous.members:[]),...data.members]
 if(new Set(members.map(person=>person.userId)).size!==members.length)throw new Error('The project directory changed. Refresh assignees.')
 return {owner:data.owner,members,total:data.total}
}
