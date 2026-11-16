import {apiFetch} from './api'
export const taskCollaborationApi={
 list:(token,taskId,stream,before,signal)=>apiFetch(`/project-tasks/${encodeURIComponent(taskId)}/${stream}?limit=20${before?'&before='+encodeURIComponent(before):''}`,{token,signal}),
 create:(token,taskId,body,signal)=>apiFetch(`/project-tasks/${encodeURIComponent(taskId)}/comments`,{method:'POST',token,body,signal}),
}
