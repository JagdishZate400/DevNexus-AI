import {apiFetch,isMockToken} from './api'

// Directory roles do not change private resource authorization.
function mutate(token,path,method,body){
  if(isMockToken(token))throw Object.assign(new Error('Sign in to manage project members.'),{status:401})
  return apiFetch(path,{token,method,body,_retried:true,signal:AbortSignal.timeout(15000)})
}
export const projectMembersApi = {
  projects:(token,signal)=>apiFetch('/project-members/projects',{token,signal:signal||AbortSignal.timeout(15000)}),
  directory:(token,projectId,offset=0,signal)=>apiFetch(`/project-members/directory?projectId=${encodeURIComponent(projectId)}&limit=20&offset=${offset}`,{token,signal:signal||AbortSignal.timeout(15000)}),
  tasks:(token,projectId,offset=0,signal)=>apiFetch(`/project-tasks/visible?projectId=${encodeURIComponent(projectId)}&limit=20&offset=${offset}`,{token,signal:signal||AbortSignal.timeout(15000)}),
  create:(token,body)=>mutate(token,'/project-members','POST',body),
  update:(token,id,displayRole)=>mutate(token,`/project-members/${encodeURIComponent(id)}`,'PATCH',{displayRole}),
  remove:(token,id)=>mutate(token,`/project-members/${encodeURIComponent(id)}`,'DELETE'),
  list(token,projectId,offset=0,signal){
    if(isMockToken(token))throw Object.assign(new Error('Sign in to view the project directory.'),{status:401})
    return apiFetch(`/project-members?projectId=${encodeURIComponent(projectId)}&limit=20&offset=${offset}`,{token,signal:signal || AbortSignal.timeout(15000)})
  },
}
