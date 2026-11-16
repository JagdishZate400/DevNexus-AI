import {Search,Users,UserRound} from 'lucide-react'
import {useEffect,useRef,useState} from 'react'
import {useAuthStore} from '../store/authStore'
import {isMockToken} from '../services/api'
import {projectMembersApi} from '../services/projectMembersApi'
import {displayRoles,formatMembershipError,validateDirectory,validateTeamProjects} from '../data/projectMembers'
import TeamProjectOptions from '../components/tasks/TeamProjectOptions'
const panel='rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]'
const button='rounded-lg border border-[#2b3558] px-3 py-2 text-sm font-bold text-[#34d399] disabled:opacity-50'
const field='rounded-lg border border-[#2b3558] bg-[#0e1428] px-3 py-2.5 text-sm text-[#b9c2d6]'
const message=error=>error.status?error.message:'Could not load the project directory. Check your connection and retry.'
function PersonCard({person,role}){
 const initials=person.displayName.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0].toUpperCase()).join('') || '?'
 return <article className={`${panel} card-glow flex items-start gap-4`}><span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#1a2340] text-sm font-bold text-[#fbbf24]">{initials}</span><div className="min-w-0"><h4 className="break-words text-base font-bold text-[#eef1f8]">{person.displayName}</h4><p className="mt-1 text-sm text-[#34d399]">{role}</p><p className="mt-2 break-all text-xs text-[#8f99b0]">{person.email}</p></div></article>
}
function MembershipActions({token,projectId,onSaved}){
 const [email,setEmail]=useState(''),[role,setRole]=useState('Developer')
 return <form aria-label="Add project member" className={`${panel} mt-4 flex flex-col gap-2`} onSubmit={event=>{event.preventDefault();onSaved(()=>projectMembersApi.create(token,{projectId,email:email.trim(),displayRole:role}),'Member added.')}}>
 <div className="flex flex-wrap gap-3">
 <input aria-label="Registered member email" type="email" maxLength={254} required className={field} value={email} onChange={e=>setEmail(e.target.value)} placeholder="Registered user email"/>
 <select aria-label="New member role" className={field} value={role} onChange={e=>setRole(e.target.value)}>{displayRoles.map(r=><option key={r}>{r}</option>)}</select><button className={button}>Add member</button></div>
 <p className="text-xs text-[#8f99b0]">Team members must already have a registered DevNexus AI account with this email before they can be added.</p></form>
}
function MemberControls({member,token,onSaved}){
 const [role,setRole]=useState(member.displayRole),[confirm,setConfirm]=useState(false)
 return <div className="mt-3 flex flex-wrap gap-2"><select aria-label={`Role for ${member.email}`} className={field} value={role} onChange={e=>setRole(e.target.value)}>{displayRoles.map(r=><option key={r}>{r}</option>)}</select><button className={button} disabled={role===member.displayRole} onClick={()=>onSaved(()=>projectMembersApi.update(token,member.id,role),'Member role updated.')}>Save role</button>
 {confirm?<div role="group" aria-label={`Confirm removal of ${member.email}`}><p>Remove {member.email} from this project?</p><button className={button} onClick={()=>onSaved(()=>projectMembersApi.remove(token,member.id),'Member removed.')}>Confirm removal</button><button className={button} onClick={()=>setConfirm(false)}>Cancel removal</button></div>:<button className={button} onClick={()=>setConfirm(true)}>Remove member</button>}</div>
}
function Directory({token,userId,project}){
 const [offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[state,setState]=useState({data:null,loading:true,error:''})
 const active=useRef(true),busy=useRef(false)
 const canManage=project.access==='owner'
 const [uncertain,setUncertain]=useState(false)
 const [mutation,setMutation]=useState({pending:false,error:'',success:''})
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 async function save(operation,success){
  if(busy.current||uncertain||!canManage||!state.data)return
  busy.current=true;setMutation({pending:true,error:'',success:''})
  try{await operation();if(active.current){setMutation({pending:false,error:'',success});setRetry(value=>value+1)}}
  catch(error){if(active.current){setUncertain(!error.status||error.status>=500||error.status===408);setMutation({pending:false,error:formatMembershipError(error).message,success:''})}}
  finally{busy.current=false}
 }
 const [search,setSearch]=useState(''),[role,setRole]=useState('All roles')
 useEffect(()=>{
  const controller=new AbortController()
  // Reset stale rows while synchronizing this page with the authenticated API.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setState({data:null,loading:true,error:''})
  Promise.resolve().then(()=>(canManage?projectMembersApi.list:projectMembersApi.directory)(token,project.id,offset,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]))).then(result=>{
   if(controller.signal.aborted)return
   const data=validateDirectory(result,project.id,offset,project.ownerId)
   if(offset>0 && offset>=data.total){setOffset(Math.max(0,Math.floor((data.total-1)/20)*20));return}
   setState({data,loading:false,error:''});setUncertain(false)
  }).catch(error=>{if(!controller.signal.aborted)setState({data:null,loading:false,error:message(error)})})
  return()=>controller.abort()
 },[token,userId,project.id,project.ownerId,canManage,offset,retry])
 const data=state.data,query=search.trim().toLowerCase()
 const members=data?.members.filter(member=>(role==='All roles' || member.displayRole===role) && (!query || [member.displayName,member.email,member.displayRole].join(' ').toLowerCase().includes(query))) || []
 return <div className="mt-6"><div className="flex justify-end"><button className={button} disabled={state.loading} onClick={()=>setRetry(value=>value+1)}>Refresh directory</button></div>
 {canManage&&<fieldset disabled={mutation.pending || state.loading || uncertain || !state.data} className="min-w-0"><MembershipActions token={token} projectId={project.id} onSaved={save}/></fieldset>}
 {mutation.pending && <p role="status">Saving membership...</p>}{mutation.success && <p role="status">{mutation.success}</p>}{mutation.error && <p role="alert" className="mt-2 text-sm text-red-400">{mutation.error}</p>}
 {state.loading && <p role="status" className="mt-4 text-sm text-[#8f99b0]">Loading project directory...</p>}
 {state.error && <div className={`${panel} mt-4`}><p role="alert" className="text-sm text-red-400">{state.error}</p><button className={`${button} mt-3`} onClick={()=>setRetry(value=>value+1)}>Retry directory</button></div>}
 {data && <><section aria-label="Project owner" className="mt-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#b9c2d6]"><UserRound size={17}/>Project owner</h3><PersonCard person={data.owner} role="Owner"/></section>
 <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Saved members',data.total],...displayRoles.map(value=>[`${value} (this page)`,data.members.filter(member=>member.displayRole===value).length])].map(([label,value])=><article key={label} className={`${panel} flex items-center gap-4`}><Users size={20} className="text-[#34d399]"/><div><p className="text-2xl font-bold text-[#eef1f8]">{value}</p><p className="text-xs text-[#8f99b0]">{label}</p></div></article>)}</div>
 <div className={`${panel} mt-6`}><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f99b0]"/><input aria-label="Search members on this page" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search by name, email, or role" className={`${field} w-full pl-10`}/></div><div className="mt-3 flex flex-wrap gap-3"><select aria-label="Filter by directory role" value={role} onChange={event=>setRole(event.target.value)} className={field}><option>All roles</option>{displayRoles.map(value=><option key={value}>{value}</option>)}</select><button className={button} onClick={()=>{setSearch('');setRole('All roles')}}>Clear filters</button></div><p className="mt-3 text-xs text-[#8f99b0]">Search, filters and role counts apply to this loaded page. The owner is separate and excluded from member totals.</p></div>
 <section aria-label="Project members" className="mt-6"><h3 className="text-sm font-bold text-[#b9c2d6]">Members</h3><p className="mt-2 text-xs text-[#8f99b0]">Showing {data.members.length?offset+1:0}-{offset+data.members.length} of {data.total} saved members; {members.length} matching on this page.</p>{members.length?<div className="animate-stagger mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{members.map(member=><div key={`${member.id}:${member.displayRole}`}><PersonCard person={member} role={member.displayRole}/>{canManage&&<fieldset disabled={mutation.pending || state.loading || uncertain}><MemberControls member={member} token={token} onSaved={save}/></fieldset>}</div>)}</div>:<div className={`${panel} mt-4 border-dashed py-12 text-center`}><h4 className="font-bold text-[#dbe2ef]">{data.total===0?'No saved members in this project':'No members match the current page filters'}</h4><p className="mt-2 text-sm text-[#8f99b0]">{data.total===0?canManage?'Add a registered user by email. The project owner is listed separately.':'The project owner manages membership.':'Clear filters or browse another page.'}</p></div>}</section>
 <div className="mt-5 flex justify-between gap-3"><button className={button} disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous members</button><button className={button} disabled={offset+20>=data.total || offset>=100000} onClick={()=>setOffset(offset+20)}>Next members</button></div></>}
 </div>
}
function TeamSession({token,userId}){
 const [state,setState]=useState({projects:null,error:''}),[projectId,setProjectId]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{
  const controller=new AbortController()
  if(isMockToken(token))return()=>controller.abort()
  projectMembersApi.projects(token,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then(data=>{
   if(controller.signal.aborted)return
   const projects=validateTeamProjects(data,userId)
   setState({projects,error:''});setProjectId(projects[0]?.id || '')
  }).catch(error=>{if(!controller.signal.aborted)setState({projects:null,error:message(error)})})
  return()=>controller.abort()
 },[token,userId,retry])
 const project=state.projects?.find(p=>p.id===projectId)
 return <section className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 lg:py-10"><div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">People</p><h2 className="text-3xl font-bold text-[#eef1f8] sm:text-4xl">Team</h2><p className="mt-2 text-sm text-[#8f99b0] sm:text-base">Manage owned teams and view teams you belong to.</p></div><div className={panel}><label htmlFor="team-project" className="mb-2 block text-sm font-semibold text-[#b9c2d6]">Team project</label><select id="team-project" value={projectId} onChange={event=>setProjectId(event.target.value)} disabled={!state.projects?.length} className={`${field} w-full`}><TeamProjectOptions projects={state.projects||[]}/></select><p className="mt-4 text-sm text-[#b9c2d6]">Members can view their project team and task list. Source, AI, documents, sprints, comments and activity remain owner-only.</p><p className="mt-2 text-xs text-[#8f99b0]">Only owners can add registered users, edit display roles, or remove members. Display roles do not grant additional permissions.</p>
 {isMockToken(token)?<p role="alert" className="mt-3 text-sm text-red-400">Sign in to load Team projects.</p>:<>{!state.projects && !state.error && <p role="status" className="mt-3 text-sm text-[#8f99b0]">Loading Team projects...</p>}{state.error && <div><p role="alert" className="mt-3 text-sm text-red-400">{state.error}</p><button className={`${button} mt-3`} onClick={()=>{setState({projects:null,error:''});setProjectId('');setRetry(value=>value+1)}}>Retry projects</button></div>}{state.projects?.length===0 && <p className="mt-3 text-sm text-[#8f99b0]">No Team projects found. Upload source to an owned project in Workspace, or ask its owner to add your registered email.</p>}</>}</div>{project&&<p className="mt-4 text-sm text-[#b9c2d6]">{project.access==='owner'?'Owned Project: membership management':'Member Project: read-only team access'}</p>}{project && <Directory key={project.id} token={token} userId={userId} project={project}/>}</section>
}
export default function TeamPage(){const token=useAuthStore(s=>s.token),user=useAuthStore(s=>s.user);return <TeamSession key={`${user?.id || user?.email || 'signed-out'}:${token || ''}`} token={token} userId={user?.id}/>}
