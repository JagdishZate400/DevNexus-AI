import {CheckCircle2,Circle,Clock3,ListTodo,Plus,Search} from 'lucide-react'
import {useEffect,useRef,useState} from 'react'
import {useAuthStore} from '../store/authStore'
import {isMockToken,projectTasksApi} from '../services/api'
import {projectTaskStatuses,projectTaskPriorities,validateProjectTask,validateProjectTaskPage} from '../data/projectTasks'
import TaskFormModal from '../components/tasks/TaskFormModal'
import TaskAssignee from '../components/tasks/TaskAssignee'
import TaskDetails from '../components/tasks/TaskDetails'

import {projectMembersApi} from '../services/projectMembersApi'
import {validateTeamProjects} from '../data/projectMembers'
import TeamProjectOptions from '../components/tasks/TeamProjectOptions'
const panel='rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]'
const button='rounded-lg border border-[#2b3558] px-3 py-2 text-sm font-semibold text-[#34d399] disabled:opacity-50'
const field='rounded-lg border border-[#2b3558] bg-[#0e1428] px-3 py-2.5 text-sm text-[#b9c2d6] outline-none'
const statusStyles={'To Do':'bg-[#1a2340] text-[#8f99b0]','In Progress':'bg-[#f59e0b]/15 text-[#fbbf24]',Done:'bg-[#34d399]/15 text-[#34d399]'}
const priorityStyles={Low:'text-[#8f99b0]',Medium:'text-[#fbbf24]',High:'text-[#f87171]'}
function taskError(error){return error.status ? error.message : 'Task request failed or its outcome is uncertain. Refresh tasks before retrying; a change may have been saved.'}
function ProjectTaskList({token,ownerId,project,projects,setProjectId,busy,setBusy}) {
 const canManage=project.access==='owner'
 const [page,setPage]=useState(null),[offset,setOffset]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('')
 const [actionError,setActionError]=useState(''),[notice,setNotice]=useState(''),[modal,setModal]=useState(null),[deleting,setDeleting]=useState(null)
 const [details,setDetails]=useState(null)
 const [filters,setFilters]=useState({search:'',status:'All statuses',priority:'All priorities'})
 const alive=useRef(true),sequence=useRef(0),inFlight=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function load(signal){
  const request=++sequence.current
  setLoading(true);setError('');setPage(null)
  try{
   const result=validateProjectTaskPage(await (canManage?projectTasksApi.list:projectMembersApi.tasks)(token,project.id,offset,signal),project.id,offset)
   if(!alive.current || request!==sequence.current)return
   if(offset>0 && offset>=result.total){setOffset(Math.max(0,Math.floor((result.total-1)/20)*20));return}
   setPage(result)
  }catch(err){if(alive.current && request===sequence.current && (!signal?.aborted || signal.reason?.name==='TimeoutError'))setError(err.status ? err.message : 'Could not load project tasks. Retry loading.')}
  finally{if(alive.current && request===sequence.current)setLoading(false)}
 }
 useEffect(()=>{
  const controller=new AbortController()
  load(AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]))
  return ()=>controller.abort()
 // Project and authentication changes remount this scoped component.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[offset])
 async function mutate(run){
  if(!canManage)throw new Error('Project tasks are read-only for members.')
  if(inFlight.current)throw new Error('A task request is already in progress.')
  inFlight.current=true;setBusy(true);setActionError('');setNotice('')
  try{return await run()}finally{inFlight.current=false;setBusy(false)}
 }
 async function save(payload,targetProjectId){
  try{
   await mutate(async()=>{
    const data=modal?.id ? await projectTasksApi.update(token,modal.id,payload) : await projectTasksApi.create(token,{projectId:targetProjectId,...payload})
    const saved=validateProjectTask(data.task,targetProjectId,modal?.id)
    if(Object.hasOwn(payload,'assigneeUserId') && saved.assigneeUserId!==payload.assigneeUserId)throw new Error('Task assignment was not confirmed.')
    if(!alive.current)return
    setNotice('Task saved.');setModal(null)
    if(targetProjectId!==project.id){setProjectId(targetProjectId);return}
    if(offset!==0){setOffset(0);return}
    await load()
   })
  }catch(err){throw new Error(taskError(err))}
 }
 async function status(task,value){
  try{await mutate(async()=>{
   const data=await projectTasksApi.update(token,task.id,{status:value})
   const updated=validateProjectTask(data.task,project.id,task.id)
   if(updated.status!==value)throw new Error('Status was not confirmed.')
   if(!alive.current)return
   setPage(previous=>previous ? {...previous,tasks:previous.tasks.map(item=>item.id===task.id?updated:item)} : previous)
   setNotice('Task status saved.')
  })}catch(err){if(alive.current)setActionError(taskError(err))}
 }
 async function remove(){
  if(!deleting)return
  try{await mutate(async()=>{
   await projectTasksApi.remove(token,deleting.id)
   if(!alive.current)return
   setDeleting(null);setNotice('Task deleted.');await load()
  })}catch(err){if(alive.current)setActionError(taskError(err))}
 }
 const tasks=page?.tasks || []
 const visible=tasks.filter(task=>(!filters.search.trim() || [task.title,task.description,project.name].join(' ').toLowerCase().includes(filters.search.trim().toLowerCase())) && (filters.status==='All statuses' || task.status===filters.status) && (filters.priority==='All priorities' || task.priority===filters.priority))
 const stats=[{label:'Loaded (this page)',value:tasks.length,Icon:ListTodo},{label:'To Do (this page)',value:tasks.filter(task=>task.status==='To Do').length,Icon:Circle},{label:'In Progress (this page)',value:tasks.filter(task=>task.status==='In Progress').length,Icon:Clock3},{label:'Done (this page)',value:tasks.filter(task=>task.status==='Done').length,Icon:CheckCircle2}]
 return <>
  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">{canManage&&<button type="button" disabled={busy || loading || !page} onClick={()=>setModal({})} className="btn-press btn-shine inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] disabled:opacity-50"><Plus size={17}/>New Task</button>}<button type="button" disabled={busy || loading} onClick={()=>load()} className={button}>{error ? 'Retry task loading' : 'Refresh tasks'}</button></div>
  {notice && <p role="status" className="mt-4 text-sm text-[#34d399]">{notice}</p>}
  {actionError && <p role="alert" className="mt-4 text-sm text-red-400">{actionError}</p>}
  {loading && <p role="status" className="mt-5 text-sm text-[#8f99b0]">Loading project tasks...</p>}
  {error && <p role="alert" className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</p>}
  {page && !loading && <>
   <p className="mt-5 text-sm text-[#8f99b0]">{page.total} saved tasks in this project. Showing {tasks.length ? offset+1 : 0}-{offset+tasks.length}. Status counts, search and filters apply only to this loaded page.</p>
   <div className="animate-stagger mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({label,value,Icon})=><article key={label} className={`${panel} card-glow flex items-center gap-4`}><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#1a2340] text-[#34d399]"><Icon size={19}/></span><div><p className="text-2xl font-bold text-[#eef1f8]">{value}</p><p className="text-xs text-[#8f99b0]">{label}</p></div></article>)}</div>
   <div className={`${panel} mt-7`}><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f99b0]"/><input aria-label="Search project tasks" value={filters.search} onChange={event=>setFilters(current=>({...current,search:event.target.value}))} placeholder="Search by title, description, or project" className={`${field} w-full py-3 pl-10`}/></div><div className="mt-3 flex flex-wrap gap-3"><select aria-label="Filter by status" value={filters.status} onChange={event=>setFilters(current=>({...current,status:event.target.value}))} className={field}><option>All statuses</option>{projectTaskStatuses.map(value=><option key={value}>{value}</option>)}</select><select aria-label="Filter by priority" value={filters.priority} onChange={event=>setFilters(current=>({...current,priority:event.target.value}))} className={field}><option>All priorities</option>{projectTaskPriorities.map(value=><option key={value}>{value}</option>)}</select><button type="button" onClick={()=>setFilters({search:'',status:'All statuses',priority:'All priorities'})} className={button}>Clear filters</button></div></div>
   <section aria-label="Project task list" className="mt-5 space-y-3"><p className="text-sm font-bold text-[#b9c2d6]">{visible.length} matching tasks on this page</p>
    {visible.map(task=><article key={task.id} aria-label={`Task: ${task.title}`} className={`${panel} card-glow`}><div className="flex flex-col justify-between gap-4 lg:flex-row"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold text-[#eef1f8]">{task.title}</h3><span className={`rounded-md px-2 py-0.5 text-xs font-bold ${statusStyles[task.status]}`}>{task.status}</span><span className={`text-xs font-bold ${priorityStyles[task.priority]}`}>{task.priority}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-sm text-[#8f99b0]">{task.description}</p><p className="mt-3 text-xs text-[#b9c2d6]">{project.name}</p><TaskAssignee task={task}/><p className="mt-2 text-xs text-[#8f99b0]">{task.sprintId ? 'Assigned to a sprint. Sprint placement is managed by the owner.' : canManage?'No sprint assigned. Assign this task from Sprints > Manage tasks to include it in sprint counts.':'No sprint assigned.'}</p></div>{canManage&&<div className="flex flex-wrap items-center gap-2"><select aria-label={`Status for ${task.title}`} value={task.status} disabled={busy} onChange={event=>status(task,event.target.value)} className={field}>{projectTaskStatuses.map(value=><option key={value}>{value}</option>)}</select><button type="button" disabled={busy} onClick={()=>status(task,projectTaskStatuses[(projectTaskStatuses.indexOf(task.status)+1)%projectTaskStatuses.length])} className={button}>Advance</button><button type="button" disabled={busy} onClick={()=>setDetails(task)} className={button} aria-label={`View details for ${task.title}`}>View details</button><button type="button" disabled={busy} onClick={()=>setModal(task)} className={button}>Edit</button><button type="button" disabled={busy} onClick={()=>{setActionError('');setDeleting(task)}} className={`${button} text-red-400`}>Delete</button></div>}</div></article>)}
    {!visible.length && <div className={`${panel} border-dashed py-12 text-center`}><h3 className="font-bold text-[#dbe2ef]">{page.total===0 ? 'No tasks in this project' : 'No tasks match the current page filters'}</h3><p className="mt-2 text-sm text-[#8f99b0]">{page.total===0 ? canManage?'Create a task to get started.':'The project owner has not added tasks yet.' : 'Clear filters or browse another page.'}</p></div>}
   </section>
   <div className="mt-5 flex justify-between gap-3"><button type="button" disabled={busy || offset===0} onClick={()=>setOffset(Math.max(0,offset-20))} className={button}>Previous tasks</button><button type="button" disabled={busy || offset+tasks.length>=page.total || offset>=100000} onClick={()=>setOffset(offset+20)} className={button}>Next tasks</button></div>
  </>}
  {canManage && details && <TaskDetails task={details} token={token} onClose={()=>setDetails(null)}/>}
  {canManage && modal && <TaskFormModal key={modal.id || 'new'} task={modal.id ? modal : null} projects={projects.filter(p=>p.access==='owner')} projectId={project.id} token={token} ownerId={ownerId} onClose={()=>setModal(null)} onSave={save}/>}
  {canManage && deleting && <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/45 p-4" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title"><div className={`${panel} w-full max-w-lg`}><h2 id="delete-task-title" className="text-xl font-bold text-[#eef1f8]">Delete task?</h2><p className="mt-4 break-words text-sm text-[#b9c2d6]">Delete "{deleting.title}"? This removes the saved task permanently.</p>{actionError && <p role="alert" className="mt-4 text-sm text-red-400">{actionError}</p>}<div className="mt-5 flex justify-end gap-3"><button type="button" disabled={busy} onClick={()=>setDeleting(null)} className={button}>Cancel</button><button type="button" disabled={busy} onClick={remove} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Deleting...' : 'Delete task'}</button></div></div></div>}
 </>
}
function TaskSession({token,ownerId}){
 const [projects,setProjects]=useState(null),[projectId,setProjectId]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false)
 useEffect(()=>{
  if(isMockToken(token))return
  const controller=new AbortController()
  projectMembersApi.projects(token,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then(data=>{
   if(controller.signal.aborted)return
   const projects=validateTeamProjects(data,ownerId)
   setProjects(projects);setProjectId(projects[0]?.id || '')
  }).catch(err=>{if(!controller.signal.aborted)setError(err.status ? err.message : 'Could not load Team projects.')})
  return ()=>controller.abort()
 },[token,ownerId,retry])
 return <section className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 lg:py-10"><div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">Delivery</p><h2 className="text-3xl font-bold tracking-tight text-[#eef1f8] sm:text-4xl">Tasks</h2><p className="mt-2 text-sm text-[#8f99b0] sm:text-base">Track saved project work with status and priority.</p></div><div className={panel}><label htmlFor="tasks-project" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Tasks project</label><select id="tasks-project" value={projectId} onChange={event=>setProjectId(event.target.value)} disabled={busy || !projects?.length || !!error} className={`${field} w-full`}><TeamProjectOptions projects={projects||[]}/></select>
  {isMockToken(token) ? <p role="alert" className="mt-3 text-sm text-red-400">Sign in to load project tasks.</p> : <>{!projects && !error && <p role="status" className="mt-3 text-sm text-[#8f99b0]">Loading Team projects...</p>}{error && <div><p role="alert" className="mt-3 text-sm text-red-400">{error}</p><button type="button" onClick={()=>{setError('');setProjects(null);setProjectId('');setRetry(value=>value+1)}} className={`${button} mt-3`}>Retry project loading</button></div>}{projects?.length===0 && <p className="mt-3 text-sm text-[#8f99b0]">No Team projects found. Upload source to an owned project or ask its owner to add you.</p>}</>}
  </div>{projects?.find(p=>p.id===projectId)?.access==='member'&&<p role="status" className="mt-4 text-sm text-[#b9c2d6]">Member Project: read-only task access. The owner manages tasks and assignments.</p>}{projectId && !error && <ProjectTaskList key={projectId} token={token} ownerId={ownerId} project={projects.find(project=>project.id===projectId)} projects={projects} setProjectId={setProjectId} busy={busy} setBusy={setBusy}/>}</section>
}
export default function TasksPage(){const token=useAuthStore(state=>state.token),user=useAuthStore(state=>state.user);return <TaskSession key={`${user?.id || user?.email || 'signed-out'}:${token || ''}`} token={token} ownerId={user?.id}/>}
