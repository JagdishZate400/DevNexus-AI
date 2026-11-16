import {CheckCircle2,Flag,Plus,Rocket,Target} from 'lucide-react'
import {useCallback,useRef,useState} from 'react'
import {useAuthStore} from '../store/authStore'
import {workspaceApi,projectSprintsApi,projectTasksApi,isMockToken} from '../services/api'
import {validateSprint,validateSprintPage,sprintStatuses,sprintError} from '../data/projectSprints'
import {validateProjectTaskPage} from '../data/projectTasks'
import {useSprintRequest} from '../hooks/useSprintRequest'
import SprintForm from '../components/sprints/SprintForm'
import TaskAssignee from '../components/tasks/TaskAssignee'
import TaskDetails from '../components/tasks/TaskDetails'
const panel='rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]'
const button='rounded-lg border border-[#2b3558] px-3 py-2 text-sm font-bold text-[#34d399] disabled:opacity-50'
const field='rounded-lg border border-[#2b3558] bg-[#0e1428] px-3 py-2 text-sm text-[#b9c2d6]'
const statusStyles={Planning:'text-[#8f99b0]',Active:'text-[#fbbf24]',Completed:'text-[#34d399]'}
function RequestState({state,label}){return <>{state.loading && <p role="status" className="mt-4 text-sm text-[#8f99b0]">Loading {label}...</p>}{state.error && <div className="mt-4"><p role="alert" className="text-sm text-red-400">{state.error}</p><button className={`${button} mt-2`} onClick={state.load}>Retry {label}</button></div>}</>}
function Pagination({offset,setOffset,page,busy,label}){return page && <div className="mt-4 flex items-center justify-between gap-3"><button className={button} disabled={busy || offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous {label}</button><span className="text-xs text-[#8f99b0]">{page.total} total</span><button className={button} disabled={busy || offset+20>=page.total || offset>=100000} onClick={()=>setOffset(offset+20)}>Next {label}</button></div>}
function Counts({sprint}){return <><p className="mt-4 text-sm text-[#b9c2d6]">To Do: {sprint.counts.toDo} / In Progress: {sprint.counts.inProgress} / Done: {sprint.counts.done} / Assigned: {sprint.counts.total}</p>{sprint.empty?<p className="mt-3 text-sm text-[#8f99b0]">No tasks assigned</p>:<div className="mt-4"><p className="mb-2 text-sm text-[#eef1f8]">Progress: {sprint.progress}%</p><div role="progressbar" aria-label="Sprint progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sprint.progress} className="h-2 overflow-hidden rounded-full bg-[#1a2340]"><div className="h-full bg-gradient-to-r from-[#f59e0b] to-[#34d399]" style={{width:`${sprint.progress}%`}}/></div></div>}</>}
function TaskPages({token,projectId,sprintId,busy,assign,revision}){
 const [details,setDetails]=useState(null)
 const [assignedOffset,setAssignedOffset]=useState(0),[candidateOffset,setCandidateOffset]=useState(0)
 const assigned=useSprintRequest(useCallback(async()=>{
  const page=validateProjectTaskPage(await projectSprintsApi.tasks(token,sprintId,assignedOffset),projectId,assignedOffset)
  if(page.tasks.some(task=>task.sprintId!==sprintId))throw new Error('Invalid task assignment response.')
  if(assignedOffset>0 && assignedOffset>=page.total)setAssignedOffset(Math.max(0,Math.floor((page.total-1)/20)*20))
  return page
 // revision refreshes task membership after a successful mutation.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[token,projectId,sprintId,assignedOffset,revision]))
 const candidates=useSprintRequest(useCallback(async()=>{
  const page=validateProjectTaskPage(await projectTasksApi.list(token,projectId,candidateOffset),projectId,candidateOffset)
  if(candidateOffset>0 && candidateOffset>=page.total)setCandidateOffset(Math.max(0,Math.floor((page.total-1)/20)*20))
  return page
 // Membership and status must refresh alongside the assigned task page.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[token,projectId,candidateOffset,revision]))
 return <>{details && <TaskDetails task={details} token={token} onClose={()=>setDetails(null)}/>}<div className="mt-5 grid gap-5 xl:grid-cols-2"><section aria-label="Assigned sprint tasks" className={panel}><h4 className="font-bold text-[#eef1f8]">Assigned tasks</h4><RequestState state={assigned} label="assigned tasks"/>{assigned.data && <>{!assigned.data.total && <p className="mt-3 text-sm text-[#8f99b0]">No tasks assigned</p>}{assigned.data.tasks.map(task=><div key={task.id} className="mt-3 flex items-center justify-between gap-3 border-t border-[#232c4b] pt-3"><div className="min-w-0 text-sm text-[#b9c2d6]"><p className="break-words">{task.title}</p><p className="text-xs text-[#8f99b0]">{task.status}</p><TaskAssignee task={task}/><button className={`${button} mt-2`} onClick={()=>setDetails(task)} aria-label={`View details for ${task.title}`}>View details</button></div><button disabled={busy} className={button} onClick={()=>assign(task.id,true)}>Remove {task.title}</button></div>)}<Pagination offset={assignedOffset} setOffset={setAssignedOffset} page={assigned.data} busy={busy} label="assigned tasks"/></>}</section>
 <section aria-label="Project task candidates" className={panel}><h4 className="font-bold text-[#eef1f8]">Add existing project tasks</h4><p className="mt-2 text-xs text-[#8f99b0]">Availability is checked by the server when assigning. Only explicitly assigned tasks contribute to sprint counts. Tasks in another sprint must be removed there first.</p><button disabled={busy || candidates.loading} onClick={candidates.load} className={`${button} mt-3`}>Refresh project tasks</button><RequestState state={candidates} label="project tasks"/>{candidates.data && <>{!candidates.data.total && <p className="mt-3 text-sm text-[#8f99b0]">No project tasks. Create tasks in Tasks first.</p>}{candidates.data.tasks.map(task=><div key={task.id} className="mt-3 flex items-center justify-between gap-3 border-t border-[#232c4b] pt-3"><div className="min-w-0"><p className="break-words text-sm text-[#b9c2d6]">{task.title} ({task.status})</p><TaskAssignee task={task}/><button className={`${button} mt-2`} onClick={()=>setDetails(task)} aria-label={`View details for ${task.title}`}>View details</button></div><button disabled={busy || assigned.loading || !assigned.data || task.sprintId===sprintId} className={button} onClick={()=>assign(task.id,false)}>Assign {task.title}</button></div>)}<Pagination offset={candidateOffset} setOffset={setCandidateOffset} page={candidates.data} busy={busy} label="project tasks"/></>}</section></div></>
}
function SprintDetail({token,projectId,id,busy,run,onChange,onClose}){
 const [revision,setRevision]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const detail=useSprintRequest(useCallback(async()=>validateSprint((await projectSprintsApi.read(token,id)).sprint,projectId,id),[token,id,projectId]))
 async function assign(taskId,remove){
  setError('');setNotice('')
  try{await run(async()=>{
   validateSprint((await projectSprintsApi.assign(token,id,taskId,remove)).sprint,projectId,id)
   setRevision(value=>value+1);await Promise.all([detail.load(),onChange()]);setNotice(remove?'Task assignment removed.':'Task assigned.')
  })}catch(err){setError(sprintError(err))}
 }
 async function refresh(){setRevision(value=>value+1);await Promise.all([detail.load(),onChange()])}
 return <section aria-label="Sprint details" className={`${panel} mt-6`}><div className="flex flex-wrap justify-between gap-3"><h3 className="text-xl font-bold text-[#eef1f8]">Sprint details</h3><div className="flex gap-2"><button disabled={busy || detail.loading} className={button} onClick={refresh}>Refresh sprint details</button><button disabled={busy} className={button} onClick={onClose}>Close details</button></div></div><RequestState state={detail} label="sprint details"/>{error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-[#34d399]">{notice}</p>}{detail.data && <><h4 className="mt-4 font-bold text-[#eef1f8]">{detail.data.name}</h4><Counts sprint={detail.data}/><TaskPages key={id} token={token} projectId={projectId} sprintId={id} busy={busy} assign={assign} revision={revision}/></>}</section>
}
function ProjectSprints({token,project,busy,setBusy}){
 const [offset,setOffset]=useState(0),[modal,setModal]=useState(null),[selected,setSelected]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const pending=useRef(false)
 const list=useSprintRequest(useCallback(async()=>{
  const page=validateSprintPage(await projectSprintsApi.list(token,project.id,offset),project.id,offset)
  if(offset>0 && offset>=page.total)setOffset(Math.max(0,Math.floor((page.total-1)/20)*20))
  return page
 },[token,project.id,offset]))
 async function run(action){if(pending.current)throw new Error('A sprint request is already in progress.');pending.current=true;setBusy(true);try{return await action()}finally{pending.current=false;setBusy(false)}}
 async function save(form){await run(async()=>{
  validateSprint((modal?.id?await projectSprintsApi.update(token,modal.id,form):await projectSprintsApi.create(token,{projectId:project.id,...form})).sprint,project.id,modal?.id)
  setSelected(null);setNotice('Sprint saved.');setError('');if(offset)setOffset(0);else await list.load()
 })}
 async function status(sprint,value){setError('');setNotice('');try{await run(async()=>{
  const updated=validateSprint((await projectSprintsApi.update(token,sprint.id,{status:value})).sprint,project.id,sprint.id)
  if(updated.status!==value)throw new Error('Status was not confirmed.')
  setSelected(null);await list.load();setNotice('Sprint status saved. Task statuses were unchanged.')
 })}catch(err){setError(sprintError(err))}}
 const sprints=list.data?.sprints || []
 const stats=[['Loaded (this page)',sprints.length,Flag],['Planning (this page)',sprints.filter(s=>s.status==='Planning').length,Target],['Active (this page)',sprints.filter(s=>s.status==='Active').length,Rocket],['Completed (this page)',sprints.filter(s=>s.status==='Completed').length,CheckCircle2]]
 return <><div className="mt-5 flex justify-between gap-3"><button disabled={busy || list.loading || !list.data} className="inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] disabled:opacity-50" onClick={()=>{setError('');setModal({})}}><Plus size={17}/>New Sprint</button><button className={button} disabled={busy || list.loading} onClick={list.load}>Refresh sprints</button></div><RequestState state={list} label="sprints"/>{error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}{notice && <p role="status" className="mt-4 text-sm text-[#34d399]">{notice}</p>}
 {list.data && <><p className="mt-5 text-sm text-[#8f99b0]">{list.data.total} saved sprints in this project. Status cards apply only to this loaded page.</p><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(([label,value,Icon])=><article key={label} className={`${panel} flex items-center gap-4`}><Icon className="text-[#34d399]" size={22}/><div><p className="text-2xl font-bold text-[#eef1f8]">{value}</p><p className="text-xs text-[#8f99b0]">{label}</p></div></article>)}</div><div className="mt-5 grid gap-5 lg:grid-cols-2">{sprints.map(sprint=><article aria-label={`Sprint: ${sprint.name}`} key={sprint.id} className={`${panel} card-glow`}><h3 className="break-words text-lg font-bold text-[#eef1f8]">{sprint.name}</h3><p className={`mt-2 text-sm font-semibold ${statusStyles[sprint.status]}`}>{sprint.status}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-[#8f99b0]">{sprint.goal}</p><p className="mt-3 text-xs text-[#b9c2d6]">{sprint.startDate} - {sprint.endDate}</p><Counts sprint={sprint}/><div className="mt-5 flex flex-wrap gap-2"><select aria-label={`Status for ${sprint.name}`} className={field} disabled={busy} value={sprint.status} onChange={event=>status(sprint,event.target.value)}>{sprintStatuses.map(value=><option key={value}>{value}</option>)}</select><button className={button} disabled={busy} onClick={()=>{setError('');setModal(sprint)}}>Edit</button><button className={button} disabled={busy} onClick={()=>setSelected(sprint.id)}>Manage tasks</button></div></article>)}</div>{!sprints.length && <p className={`${panel} mt-5 text-center text-[#8f99b0]`}>No saved sprints in this project. Create a sprint to get started.</p>}<Pagination offset={offset} setOffset={setOffset} page={list.data} busy={busy} label="sprints"/></>}
 {selected && <SprintDetail key={selected} token={token} projectId={project.id} id={selected} busy={busy} run={run} onChange={list.load} onClose={()=>setSelected(null)}/>}{modal && <SprintForm sprint={modal.id?modal:null} onSave={save} onClose={()=>setModal(null)}/>}</>
}
function SprintSession({token}){
 const [projectId,setProjectId]=useState(''),[busy,setBusy]=useState(false)
 const projects=useSprintRequest(useCallback(async()=>{
  if(isMockToken(token))throw Object.assign(new Error('Sign in to load owned project sprints.'),{status:401})
  const result=await workspaceApi.projects(token,AbortSignal.timeout(15000))
  if(!Array.isArray(result.projects) || result.projects.some(p=>!p || typeof p.id!=='string' || !p.id || typeof p.name!=='string') || new Set(result.projects.map(p=>p.id)).size!==result.projects.length)throw new Error('Invalid owned project response.')
  setProjectId(current=>result.projects.some(p=>p.id===current)?current:result.projects[0]?.id || '')
  return result.projects
 },[token]),{refreshOnFocus:false})
 const project=projects.data?.find(p=>p.id===projectId)
 return <section className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 lg:py-10"><div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">Planning</p><h2 className="text-3xl font-bold text-[#eef1f8] sm:text-4xl">Sprints</h2><p className="mt-2 text-sm text-[#8f99b0]">Define goals and track progress from saved project tasks.</p></div><div className={panel}><label htmlFor="sprints-project" className="mb-2 block text-sm font-semibold text-[#b9c2d6]">Sprints project</label><select id="sprints-project" className={`${field} w-full`} disabled={busy || !projects.data?.length} value={projectId} onChange={event=>setProjectId(event.target.value)}>{projects.data?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><RequestState state={projects} label="projects"/>{projects.data?.length===0 && <p className="mt-4 text-sm text-[#8f99b0]">No owned projects found. Create a durable project in Workspace first.</p>}</div>{project && <ProjectSprints key={project.id} token={token} project={project} busy={busy} setBusy={setBusy}/>}</section>
}
export default function SprintsPage(){const token=useAuthStore(s=>s.token),user=useAuthStore(s=>s.user);return <SprintSession key={`${user?.id || user?.email || 'signed-out'}:${token || ''}`} token={token}/>}
