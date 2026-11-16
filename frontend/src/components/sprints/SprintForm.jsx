import {useRef,useState} from 'react'
import {sprintStatuses,sprintError} from '../../data/projectSprints'
const field='w-full rounded-lg border border-[#2b3558] bg-[#0e1428] px-3 py-2.5 text-sm text-[#eef1f8]'
export default function SprintForm({sprint,onSave,onClose}){
 const [form,setForm]=useState({name:sprint?.name || '',goal:sprint?.goal || '',startDate:sprint?.startDate || '',endDate:sprint?.endDate || '',status:sprint?.status || 'Planning'})
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false)
 function update(event){setForm(value=>({...value,[event.target.name]:event.target.value}));setError('')}
 async function submit(event){
  event.preventDefault();if(pending.current)return
  if(!form.name.trim() || form.name.length>160 || form.goal.length>1000 || !form.startDate || !form.endDate || form.endDate<form.startDate){setError('Enter a name and valid dates. End date must be on or after start date.');return}
  pending.current=true;setBusy(true);setError('')
  try{await onSave({...form,name:form.name.trim()});onClose()}catch(err){setError(sprintError(err))}finally{pending.current=false;setBusy(false)}
 }
 return <div role="dialog" aria-modal="true" aria-labelledby="sprint-form-title" className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/60 p-4" onKeyDown={event=>{if(event.key==='Escape' && !busy)onClose()}}><div className="modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6">
  <h2 id="sprint-form-title" className="text-2xl font-bold text-[#eef1f8]">{sprint?'Edit sprint':'Create sprint'}</h2>
  <form onSubmit={submit} noValidate className="mt-6 space-y-4"><fieldset disabled={busy} className="space-y-4">
   <label className="block text-sm text-[#b9c2d6]">Sprint name<input autoFocus name="name" value={form.name} onChange={update} maxLength={160} className={`${field} mt-2`}/></label>
   <div><label htmlFor="sprint-goal" className="block text-sm text-[#b9c2d6]">Goal</label><textarea id="sprint-goal" name="goal" value={form.goal} onChange={update} maxLength={1000} rows={3} className={`${field} mt-2`}/></div>
   <div className="grid gap-4 sm:grid-cols-2">{[['startDate','Start date'],['endDate','End date']].map(([name,label])=><label key={name} className="block text-sm text-[#b9c2d6]">{label}<input name={name} type="date" value={form[name]} onChange={update} className={`${field} mt-2`}/></label>)}</div>
   {sprint && <label className="block text-sm text-[#b9c2d6]">Sprint status<select name="status" value={form.status} onChange={update} className={`${field} mt-2`}>{sprintStatuses.map(status=><option key={status}>{status}</option>)}</select></label>}
  </fieldset>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}<div className="flex justify-end gap-3"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-[#2b3558] px-4 py-2 text-[#b9c2d6]">Cancel</button><button type="submit" disabled={busy} className="rounded-lg bg-[#f59e0b] px-4 py-2 font-bold text-[#231303] disabled:opacity-50">{busy?'Saving...':sprint?'Save sprint':'Create sprint'}</button></div></form>
 </div></div>
}
