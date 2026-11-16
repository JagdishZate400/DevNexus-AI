import {useEffect,useRef,useState} from 'react'
import {projectMembersApi} from '../../services/projectMembersApi'
import {mergeAssigneePage} from '../../data/taskAssignees'

const label=person=>`${person.displayName} — ${person.email}`
export default function TaskAssigneeField({token,ownerId,projectId,value,currentAssignee,disabled,onChange,onValidityChange}){
 const [directory,setDirectory]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 const alive=useRef(false),request=useRef(0),controller=useRef(null),pending=useRef(false)
 function cancel(){alive.current=false;request.current++;controller.current?.abort()}
 async function load(offset=0,previous=null){
  if(pending.current)return
  pending.current=true;const sequence=++request.current
  controller.current=new AbortController()
  setLoading(true);setError('')
  try{
   const signal=AbortSignal.any([controller.current.signal,AbortSignal.timeout(15000)])
   const result=mergeAssigneePage(previous,await projectMembersApi.list(token,projectId,offset,signal),projectId,offset,ownerId)
   if(alive.current && sequence===request.current)setDirectory(result)
  }catch(err){if(alive.current && sequence===request.current && !controller.current?.signal.aborted)setError(err.status?err.message:err.message==='The project directory changed. Refresh assignees.'?err.message:'Could not load assignees. Retry the directory request.')}
  finally{if(alive.current && sequence===request.current){pending.current=false;setLoading(false)}}
 }
 useEffect(()=>{
  alive.current=true;pending.current=false;setDirectory(null);load()
  return cancel
 // Parent keys this component by project, account and token, preventing cross-scope reuse.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[revision])
 const people=directory?[directory.owner,...directory.members]:[]
 const missing=value && !people.some(person=>person.userId===value)
 useEffect(()=>{onValidityChange(!value || (!!directory && !missing))},[value,directory,missing,onValidityChange])
 return <div className="rounded-xl border border-[#2b3558] bg-[#0e1428]/60 p-4">
  <label htmlFor="task-assignee" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Assignee</label>
  <select id="task-assignee" value={value || ''} disabled={disabled || !directory || loading} onChange={event=>onChange(event.target.value || null)} aria-describedby="task-assignee-help" className="w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2.5 text-sm text-[#eef1f8] outline-none focus:border-[#f59e0b] disabled:opacity-60">
   <option value="">Unassigned</option>
   {missing && <option value={value} disabled>{currentAssignee?.userId===value?`${label(currentAssignee)} (current assignment)`:'Selected assignee — refresh to verify'}</option>}
   {directory && <optgroup label="Project owner"><option value={directory.owner.userId}>{label(directory.owner)} (Owner)</option></optgroup>}
   {!!directory?.members.length && <optgroup label="Registered members">{directory.members.map(person=><option key={person.userId} value={person.userId}>{label(person)} ({person.displayRole})</option>)}</optgroup>}
  </select>
  <p id="task-assignee-help" className="mt-2 text-xs text-[#8f99b0]">Choose a person responsible for this task. Sprint placement is managed separately.</p>
  {loading && <p role="status" className="mt-2 text-xs text-[#b9c2d6]">Loading assignees…</p>}
  {directory && <p className="mt-2 text-xs text-[#8f99b0]">{directory.total ? `${directory.members.length} of ${directory.total} registered members loaded.`:'No registered members yet. The project owner is available.'}</p>}
  {missing && !loading && <p className="mt-2 text-xs text-[#fbbf24]">The current selection is not in the loaded directory. Load more or refresh to verify it; choose Unassigned to clear it. Unchanged assignments are preserved by the server.</p>}
  {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
  <div className="mt-3 flex flex-wrap gap-3">
   {directory && directory.members.length<directory.total && <button type="button" disabled={disabled || loading || !!error} onClick={()=>load(directory.members.length,directory)} className="text-xs font-semibold text-[#34d399] disabled:opacity-50">Load more assignees</button>}
   <button type="button" disabled={disabled || loading} onClick={()=>setRevision(value=>value+1)} className="text-xs font-semibold text-[#34d399] disabled:opacity-50">{error?'Retry assignees':'Refresh assignees'}</button>
  </div>
 </div>
}
