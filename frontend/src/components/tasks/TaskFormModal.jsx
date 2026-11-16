import {useEffect,useRef,useState} from 'react'
import {X} from 'lucide-react'
import {projectTaskPriorities} from '../../data/projectTasks'
import TaskAssigneeField from './TaskAssigneeField'

const field='w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2.5 text-sm text-[#eef1f8] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10'
export default function TaskFormModal({task,projects,projectId,token,ownerId,onClose,onSave}) {
 const [form,setForm]=useState({title:task?.title || '',description:task?.description || '',priority:task?.priority || 'Medium',projectId:task?.projectId || projectId,assigneeUserId:task?.assigneeUserId || null})
 const [selectionValid,setSelectionValid]=useState(false)
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const inFlight=useRef(false),panel=useRef(null),alive=useRef(true)
 useEffect(()=>{
  alive.current=true;const previous=document.activeElement;panel.current?.querySelector('input')?.focus()
  return ()=>{alive.current=false;if(previous?.isConnected)previous.focus()}
 },[])
 function update(event){const {name,value}=event.target;setForm(current=>({...current,[name]:value,...(name==='projectId'?{assigneeUserId:null}:{})}));if(name==='projectId')setSelectionValid(false);setError('')}
 async function submit(event){
  event.preventDefault();if(inFlight.current)return
  if(!form.title.trim()){setError('Title is required.');return}
  if(form.title.length>200 || form.description.length>2000 || !projectTaskPriorities.includes(form.priority) || !projects.some(project=>project.id===form.projectId)){setError('Check the task fields and selected project.');return}
  const changed=form.assigneeUserId!==(task?.assigneeUserId || null)
  if(changed && form.assigneeUserId && !selectionValid){setError('Choose an assignee from the current project directory, or choose Unassigned.');return}
  inFlight.current=true;setBusy(true);setError('')
  try{await onSave({title:form.title.trim(),description:form.description,priority:form.priority,...(!task || changed?{assigneeUserId:form.assigneeUserId}:{})},form.projectId);if(alive.current)onClose()}
  catch(err){if(alive.current)setError(err.message || 'Could not save the task.')}
  finally{inFlight.current=false;if(alive.current)setBusy(false)}
 }
 return <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/45 p-4" role="dialog" aria-modal="true" aria-labelledby="task-form-title" onKeyDown={event=>{
  if(event.key==='Escape' && !busy)onClose()
  if(event.key==='Tab'){const nodes=[...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus()}}
 }}>
  <div ref={panel} className="modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-2xl sm:p-8">
   <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#fbbf24]">{task ? 'Edit task' : 'New task'}</p><h2 id="task-form-title" className="mt-2 text-2xl font-bold text-[#eef1f8]">{task ? 'Edit task' : 'Create task'}</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close task dialog" className="rounded-lg p-2 text-[#8f99b0]"><X size={19}/></button></div>
   <form onSubmit={submit} noValidate className="mt-7 space-y-4">
    <div><label htmlFor="task-title" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Title</label><input id="task-title" name="title" value={form.title} onChange={update} maxLength={200} disabled={busy} className={field} placeholder="e.g. Verify documentation export"/></div>
    <div><label htmlFor="task-description" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Description</label><textarea id="task-description" name="description" value={form.description} onChange={update} maxLength={2000} rows={3} disabled={busy} className={field}/><p className="mt-1 text-xs text-[#8f99b0]">Optional, up to 2,000 characters.</p></div>
    <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="task-priority" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Priority</label><select id="task-priority" name="priority" value={form.priority} onChange={update} disabled={busy} className={field}>{projectTaskPriorities.map(priority=><option key={priority}>{priority}</option>)}</select></div><div><label htmlFor="task-project" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Project</label><select id="task-project" name="projectId" value={form.projectId} onChange={update} disabled={busy || !!task} className={field}>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></div></div>
    <TaskAssigneeField key={`${ownerId}:${token}:${form.projectId}`} token={token} ownerId={ownerId} projectId={form.projectId} value={form.assigneeUserId} currentAssignee={task?.assignee} disabled={busy} onChange={value=>{setForm(current=>({...current,assigneeUserId:value}));setError('')}} onValidityChange={setSelectionValid}/>
    {!task && <p className="text-xs text-[#8f99b0]">New tasks start as To Do. Assignee is optional; you can save an unassigned task while the directory is unavailable.</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="flex justify-end gap-3 pt-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-[#2b3558] px-4 py-2.5 text-sm font-bold text-[#b9c2d6]">Cancel</button><button type="submit" disabled={busy} className="btn-shine rounded-lg bg-[#f59e0b] px-4 py-2.5 text-sm font-bold text-[#231303] disabled:opacity-60">{busy ? 'Saving...' : task ? 'Save changes' : 'Create task'}</button></div>
   </form>
  </div>
 </div>
}
