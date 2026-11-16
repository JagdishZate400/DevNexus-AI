import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { workspaceApi, repositoryReviewBatchesApi, isMockToken } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
function ReviewForm({ onClose, onStart }) {
  const token=useAuthStore((s)=>s.token)
  const [projects,setProjects]=useState([])
  const [projectsLoaded,setProjectsLoaded]=useState(false)
  const [projectId,setProjectId]=useState('')
  const [fileId,setFileId]=useState('')
  const [mode,setMode]=useState('single')
  const [fileIds,setFileIds]=useState([])
  const [filesState,setFilesState]=useState(null)
  const [error,setError]=useState('')
  const [focus,setFocus]=useState('General')
  const [preview,setPreview]=useState(null)
  const [previewRefresh,setPreviewRefresh]=useState(0)
  const [submitting,setSubmitting]=useState(false)
  const request=useRef(null)
  const busy=useRef(false)
  const dialog=useRef(null)
  useEffect(()=>{
    const previous=document.activeElement
    dialog.current?.querySelector('button')?.focus()
    return ()=>previous?.focus()
  },[])
  function keyboard(e){
    if(e.key==='Escape' && !busy.current){e.preventDefault();onClose()}
    if(e.key!=='Tab')return
    const controls=[...dialog.current.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href]')]
    const first=controls[0],last=controls.at(-1)
    if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus()}
    else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus()}
  }
  const previewCache=useRef(new Map())
  useEffect(()=>{
    if(mode!=='project' || !projectId) return
    const controller=new AbortController()
    const cached=previewCache.current.get(projectId)
    if(cached){setPreview(cached);return}
    setPreview({projectId,loading:true})
    repositoryReviewBatchesApi.preview(token,projectId,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then((data)=>{
      if(controller.signal.aborted) return
      const counts=[data.totalDiscoveredFiles,data.eligibleCandidateCount,data.knownSkippedFileCount,data.totalSourceBytes]
      if(!counts.every((n)=>Number.isSafeInteger(n)&&n>=0) || counts[1]+counts[2]!==counts[0] || !Array.isArray(data.skipReasons)) throw new Error('Invalid project preview response.')
      const result={projectId,data};previewCache.current.set(projectId,result);setPreview(result)
    }).catch((err)=>{if(!controller.signal.aborted)setPreview({projectId,error:err.name==='TimeoutError' ? 'Project preview timed out. Try refreshing.' : err.message})})
    return ()=>controller.abort()
  },[token,projectId,mode,previewRefresh])
  async function submit(e){
    e.preventDefault()
    if(!ready || busy.current) return
    busy.current=true;setSubmitting(true);setError('')
    const signature=JSON.stringify([projectId,mode,focus,mode==='batch' ? [...fileIds].sort() : mode==='project' ? null : fileId])
    if(request.current?.signature!==signature)request.current={signature,key:crypto.randomUUID()}
    try {await onStart({projectId,...(mode==='single' ? {fileId} : mode==='project' ? {scope:'Entire Project',idempotencyKey:request.current.key} : {fileIds,idempotencyKey:request.current.key}),options:{focus}})}
    catch(err){setError(err.message || 'Review submission failed. Check saved history before starting a new review.');}
    finally{busy.current=false;setSubmitting(false)}
  }
  useEffect(()=>{
    const controller=new AbortController()
    if(!isMockToken(token)) workspaceApi.projects(token,controller.signal).then((data)=>{
      if(!controller.signal.aborted){setProjects(data.projects);setProjectId(data.projects[0]?.id || '');setProjectsLoaded(true)}
    }).catch((err)=>{if(!controller.signal.aborted)setError(err.message)})
    return ()=>controller.abort()
  },[token])
  useEffect(()=>{
    const controller=new AbortController()
    if(projectId) workspaceApi.files(token,projectId,controller.signal).then((data)=>{
      if(!controller.signal.aborted){setFilesState({projectId,files:data.files});setFileId(data.files[0]?.id || '')}
    }).catch((err)=>{if(!controller.signal.aborted)setFilesState({projectId,error:err.message,files:[]})})
    return ()=>controller.abort()
  },[token,projectId])
  const current=filesState?.projectId===projectId ? filesState : null
  const projectPreview=preview?.projectId===projectId ? preview : null
  const data=projectPreview?.data
  const withinLimits=data && data.totalDiscoveredFiles<=200 && data.totalSourceBytes<=10485760
  const ready=mode==='project' ? withinLimits && data.eligibleCandidateCount>0 : mode==='single' ? current?.files?.some((f)=>f.id===fileId) : fileIds.length>0 && fileIds.length<=3 && fileIds.every((id)=>current?.files?.some((f)=>f.id===id))
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/45 p-4 modal-overlay" ref={dialog} onKeyDown={keyboard} role="dialog" aria-modal="true" aria-labelledby="start-review-title"><form onSubmit={submit} className="modal-panel max-h-[90vh] overflow-auto w-full max-w-lg rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-2xl">
    <div className="flex items-center justify-between"><h2 id="start-review-title" className="text-2xl font-bold text-[#eef1f8]">Review uploaded source</h2><button type="button" disabled={submitting} onClick={onClose} aria-label="Close review setup"><X size={19}/></button></div>
    {(error || (mode!=='project' && current?.error)) && <p role="alert" className="mt-4 text-sm text-red-400">{error || current.error}</p>}
    <label className="mt-5 block text-sm text-[#dbe2ef]">Review mode<select aria-label="Review mode" disabled={submitting} value={mode} onChange={(e)=>setMode(e.target.value)} className="mt-2 block w-full rounded-lg bg-[#0e1428] p-3"><option value="single">Single File Review</option><option value="batch">Review Selected Files</option><option value="project">Review Entire Project</option></select></label>
    <label className="mt-6 block text-sm text-[#dbe2ef]">Project<select aria-label="Project" disabled={submitting} value={projectId} onChange={(e)=>{setProjectId(e.target.value);setFileId('');setFileIds([])}} className="mt-2 block w-full rounded-lg bg-[#0e1428] p-3">{projects.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {!projectsLoaded && !error && <p role="status" className="mt-3 text-xs text-[#8f99b0]">Loading owned projects...</p>}
    {projectsLoaded && !projects.length && !error && <p className="mt-3 text-xs text-[#8f99b0]">No owned projects loaded. Create a project and upload source in Workspace.</p>}
    {mode==='project' ? <section aria-label="Project review preview" className="mt-5 space-y-3 text-sm text-[#b9c2d6]">
      {(!projectPreview || projectPreview.loading) && projectId && <p role="status">Loading project preview...</p>}
      {projectPreview?.error && <p role="alert" className="text-red-400">{projectPreview.error}</p>}
      {data && <><p>Discovered files: {data.totalDiscoveredFiles}</p><p>Eligible candidates: {data.eligibleCandidateCount}</p><p>Known excluded files: {data.knownSkippedFileCount}</p><ul>{data.skipReasons.map((reason)=><li key={reason.code}>{reason.count}: {reason.message} ({reason.code})</li>)}</ul>{!data.totalDiscoveredFiles && <p>This project has no uploaded source files.</p>}{data.totalDiscoveredFiles>0 && !data.eligibleCandidateCount && <p>No eligible candidate files to review.</p>}{!withinLimits && <p role="alert">Project exceeds discovery limits. No review can be submitted.</p>}<p>Eligibility is preliminary. Each file is validated again by the worker before review.</p></>}
      <p>Discovery limits: 200 files and 10 MiB total source. Each reviewable file: 50,000 characters, 512 KiB and 10,000 lines.</p>
      <p>Files are reviewed individually. Cross-file dependencies are not analyzed in this mode.</p>
      <button type="button" disabled={submitting || projectPreview?.loading || !projectId} onClick={()=>{previewCache.current.delete(projectId);setPreview({projectId,loading:true});setPreviewRefresh((n)=>n+1)}} className="text-[#34d399] underline">Refresh preview</button>
    </section> : mode==='single' ? <label className="mt-5 block text-sm text-[#dbe2ef]">Uploaded source file<select aria-label="Uploaded source file" value={fileId} onChange={(e)=>setFileId(e.target.value)} disabled={submitting || !current?.files?.length} className="mt-2 block w-full rounded-lg bg-[#0e1428] p-3">{(current?.files || []).map((f)=><option key={f.id} value={f.id}>{f.path}</option>)}</select></label> : <fieldset className="mt-5"><legend className="text-sm text-[#dbe2ef]">Select up to 3 uploaded files</legend><div className="mt-2 max-h-44 overflow-auto">{(current?.files || []).map((f)=><label key={f.id} className="flex items-center gap-2 py-2 text-sm text-[#dbe2ef]"><input type="checkbox" checked={fileIds.includes(f.id)} disabled={submitting || (!fileIds.includes(f.id) && fileIds.length>=3)} onChange={(e)=>setFileIds((ids)=>e.target.checked ? [...ids,f.id] : ids.filter((id)=>id!==f.id))}/>{f.path}</label>)}</div><p className="mt-2 text-xs text-[#8f99b0]">Selected: {(current?.files || []).filter((f)=>fileIds.includes(f.id)).map((f)=>f.path).join(', ') || 'None'}</p></fieldset>}
    {mode!=='project' && projectId && !current && <p role="status" className="mt-3 text-xs text-[#8f99b0]">Loading uploaded files...</p>}
    {mode!=='project' && current && !current.files.length && !current.error && <p className="mt-3 text-xs text-[#8f99b0]">No uploaded source files in this project.</p>}
    <label className="mt-5 block text-sm text-[#dbe2ef]">Review focus<select aria-label="Review focus" disabled={submitting} value={focus} onChange={(e)=>setFocus(e.target.value)} className="mt-2 block w-full rounded-lg bg-[#0e1428] p-3">{['General','Bugs','Security','Maintainability'].map((f)=><option key={f}>{f}</option>)}</select></label>
    <p className="mt-5 text-xs leading-5 text-[#8f99b0]">{mode!=='single' ? 'Reviews files independently in a durable background batch.' : 'Reviews one complete uploaded file.'} Each file is limited to 50,000 characters, without truncation. Source is sent to Gemini as untrusted text and is never executed. Results and triage are saved.</p>
    <button type="submit" disabled={!ready || submitting} className="mt-6 w-full rounded-lg bg-[#f59e0b] p-3 font-bold text-[#231303] disabled:opacity-50">{submitting ? 'Submitting review...' : 'Start Code Review'}</button>
    {error && <p className="mt-3 text-xs text-[#8f99b0]">Retrying the same selection reuses its request key. Check saved history before starting a new review.</p>}
  </form></div>
}
export default function StartReviewModal({isOpen,onClose,onStart}) { return isOpen ? <ReviewForm onClose={onClose} onStart={onStart}/> : null }
