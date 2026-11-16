import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { analysisTypes, bugFocusOptions, scopes, securityFocusOptions } from '../../data/securityData'

import { workspaceApi, repositoryReviewBatchesApi, isMockToken } from '../../services/api'
import { useAuthStore } from '../../store/authStore'

function AnalysisForm({ onClose, onStart }) {
  const token = useAuthStore((state) => state.token)
  const [projectId, setProjectId] = useState('')
  const [projectState, setProjectState] = useState({token, attempt:0, projects: [], loading: true, error: ''})
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    if(isMockToken(token)) {
      return () => controller.abort()
    }
    workspaceApi.projects(token,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then((data)=>{
      if(controller.signal.aborted)return
      if(!Array.isArray(data.projects) || data.projects.some((p)=>!p || typeof p.id!=='string' || !p.id || typeof p.name!=='string'))throw new Error('Invalid project listing response.')
      setProjectState({token,attempt:retry,projects:data.projects,loading:false,error:''})
      setProjectId(data.projects[0]?.id || '')
    }).catch((err)=>{
      if(!controller.signal.aborted)setProjectState({token,attempt:retry,projects:[],loading:false,error:err.name==='TimeoutError' ? 'Project loading timed out. Try again.' : err.message || 'Could not load owned projects.'})
    })
    return ()=>controller.abort()
  },[token,retry])
  const current=isMockToken(token) ? {projects:[],loading:false,error:'Sign in to load your owned projects.'} : projectState.token===token && projectState.attempt===retry ? projectState : {projects:[],loading:true,error:''}
  const projects=current.projects
  const [analysisType,setAnalysisType]=useState('Bugs Only')
  const [scope,setScope]=useState('Entire Project')
  const [fileId,setFileId]=useState('')
  const [filesState,setFilesState]=useState(null)
  const [filesRetry,setFilesRetry]=useState(0)
  useEffect(()=>{
    if(scope!=='Single File' || !projectId || isMockToken(token))return
    const controller=new AbortController()
    workspaceApi.files(token,projectId,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then((data)=>{
      if(controller.signal.aborted)return
      if(!Array.isArray(data.files) || data.files.some((file)=>!file || typeof file.id!=='string' || typeof file.path!=='string'))throw new Error('Invalid uploaded file response.')
      setFilesState({token,projectId,attempt:filesRetry,files:data.files});setFileId(data.files[0]?.id || '')
    }).catch((err)=>{if(!controller.signal.aborted)setFilesState({token,projectId,attempt:filesRetry,files:[],error:err.name==='TimeoutError' ? 'File loading timed out.' : err.message})})
    return ()=>controller.abort()
  },[token,projectId,scope,filesRetry])
  const currentFiles=filesState?.token===token && filesState?.projectId===projectId && filesState?.attempt===filesRetry ? filesState : null
  const focus={ 'Bugs Only':'Bugs', 'Security Only':'Security', 'Full Analysis':'BugsAndSecurity' }[analysisType]
  const bugFocus=[], securityFocus=[]
  const [submissionError,setSubmissionError]=useState('')
  const [submitting,setSubmitting]=useState(false)
  const [preview,setPreview]=useState(null)
  const [previewRetry,setPreviewRetry]=useState(0)
  const busy=useRef(false), request=useRef(null)
  useEffect(()=>{
    if(scope!=='Entire Project' || !projectId || isMockToken(token))return
    const controller=new AbortController()
    repositoryReviewBatchesApi.preview(token,projectId,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then((data)=>{
      if(controller.signal.aborted)return
      if(![data.totalDiscoveredFiles,data.eligibleCandidateCount,data.knownSkippedFileCount,data.totalSourceBytes].every((n)=>Number.isSafeInteger(n)&&n>=0) || data.eligibleCandidateCount+data.knownSkippedFileCount!==data.totalDiscoveredFiles || !Array.isArray(data.skipReasons))throw new Error('Invalid project preview response.')
      setPreview({token,projectId,attempt:previewRetry,data})
    }).catch((err)=>{if(!controller.signal.aborted)setPreview({token,projectId,attempt:previewRetry,error:err.name==='TimeoutError' ? 'Project preview timed out.' : err.message})})
    return ()=>controller.abort()
  },[token,projectId,previewRetry,scope])
  const currentPreview=preview?.token===token && preview?.projectId===projectId && preview?.attempt===previewRetry ? preview : null
  const data=currentPreview?.data
  const ready=['Bugs Only','Security Only','Full Analysis'].includes(analysisType) && !current.loading && !current.error && projects.some((p)=>p.id===projectId) && (scope==='Single File' ? !currentFiles?.error && currentFiles?.files.some((file)=>file.id===fileId) : scope==='Entire Project' && data?.eligibleCandidateCount>0 && data.totalDiscoveredFiles<=200 && data.totalSourceBytes<=10485760)
  async function submitForm(event){
    event.preventDefault()
    if(!ready || busy.current)return
    busy.current=true;setSubmitting(true);setSubmissionError('')
    if(request.current?.projectId!==projectId || request.current?.focus!==focus || request.current?.scope!==scope)request.current={projectId,focus,scope,key:crypto.randomUUID()}
    try{await onStart(scope==='Single File' ? {projectId,fileId,options:{focus}} : {projectId,scope:'Entire Project',options:{focus},idempotencyKey:request.current.key})}
    catch(err){setSubmissionError(err.name==='TimeoutError' ? scope==='Single File' ? 'Single-file analysis timed out. Check saved history before retrying; it may already have been saved.' : 'Submission timed out. Check saved history before starting another analysis; retry uses the same request key.' : err.message || 'Analysis submission failed.')}
    finally{busy.current=false;setSubmitting(false)}
  }

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-analysis-title"
    >
      <div className="modal-panel max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#fbbf24]">Analysis</p>
            <h2 id="run-analysis-title" className="mt-2 text-2xl font-bold text-[#eef1f8]">
              Run Security & Bugs Analysis
            </h2>
          </div>
          <button
            type="button"
            disabled={submitting} onClick={onClose}
            aria-label="Close analysis setup"
            className="rounded-lg p-2 text-[#8f99b0] hover:bg-[#1a2340]"
          >
            <X size={19} />
          </button>
        </div>

        <form onSubmit={submitForm} className="mt-7 space-y-5">
          {/* Project Selection */}
          <div>
            <label htmlFor="analysis-project" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">
              Project
            </label>
            <select
              id="analysis-project"
              disabled={submitting || current.loading || !!current.error || !projects.length}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2.5 text-sm text-[#eef1f8] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {current.loading && <p role="status" className="mt-2 text-sm text-[#8f99b0]">Loading owned projects...</p>}
            {current.error && <div className="mt-2"><p role="alert" className="text-sm text-red-400">{current.error}</p>{!isMockToken(token) && <button type="button" onClick={()=>setRetry((n)=>n+1)} className="mt-2 text-sm text-[#34d399] underline">Retry project loading</button>}</div>}
            {!current.loading && !current.error && !projects.length && <p className="mt-2 text-sm text-[#8f99b0]">No owned projects found. Create a project and upload source in Workspace.</p>}
          </div>

          {/* Analysis Type */}
          <div>
            <p className="mb-2 text-sm font-semibold text-[#dbe2ef]">Analysis Type</p>
            <div className="grid grid-cols-3 gap-2">
              {analysisTypes.map((item) => (
                <label
                  key={item}
                  className={`cursor-pointer rounded-lg border px-3 py-2.5 text-xs font-semibold transition ${
                    analysisType === item
                      ? 'border-[#34d399] bg-[#1a2340] text-[#34d399]'
                      : 'border-[#2b3558] text-[#8f99b0] hover:border-[#2b3558]'
                  }`}
                >
                  <input
                    type="radio"
                    name="analysisType"
                    value={item}
                    checked={analysisType === item}
                    onChange={()=>{if(['Bugs Only','Security Only','Full Analysis'].includes(item)){setAnalysisType(item);setSubmissionError('')}}}
                    disabled={submitting}
                    className="sr-only"
                  />
                  {item}
                </label>
              ))}
            </div>
          </div>

          {/* Analysis Scope */}
          <div>
            <p className="mb-2 text-sm font-semibold text-[#dbe2ef]">Analysis Scope</p>
            <div className="grid grid-cols-3 gap-2">
              {scopes.map((item) => (
                <label
                  key={item}
                  className={`cursor-pointer rounded-lg border px-3 py-2.5 text-xs font-semibold transition ${
                    scope === item
                      ? 'border-[#34d399] bg-[#1a2340] text-[#34d399]'
                      : 'border-[#2b3558] text-[#8f99b0] hover:border-[#2b3558]'
                  }`}
                >
                  <input
                    type="radio"
                    name="scope"
                    value={item}
                    checked={scope === item}
                    onChange={()=>{if(['Entire Project','Single File'].includes(item)){setScope(item);setSubmissionError('')}}}
                    disabled={item==='Folder' || submitting}
                    className="sr-only"
                  />
                  {item}
                </label>
              ))}
            </div>
          </div>

          {scope==='Single File' && <section aria-label="Uploaded file selection" className="space-y-2 text-sm text-[#b9c2d6]">
            <label>Uploaded source file<select aria-label="Uploaded source file" value={currentFiles ? fileId : ''} disabled={submitting || !currentFiles?.files.length || !!currentFiles?.error} onChange={(e)=>setFileId(e.target.value)} className="mt-2 w-full rounded bg-[#0e1428] p-3">{(currentFiles?.files || []).map((file)=><option key={file.id} value={file.id}>{file.path}</option>)}</select></label>
            {projectId && !currentFiles && <p role="status">Loading uploaded files...</p>}
            {currentFiles?.error && <p role="alert">{currentFiles.error}</p>}
            {currentFiles && !currentFiles.error && !currentFiles.files.length && <p>No uploaded source files in this project.</p>}
            <button type="button" disabled={submitting || !projectId || !currentFiles} onClick={()=>setFilesRetry((n)=>n+1)} className="text-[#34d399] underline">Refresh files</button>
            <p>One complete uploaded JS/TS file is reviewed, with server-side safety validation. Maximum 50,000 characters. This request may take up to 90 seconds; results are saved.</p>
          </section>}

          {/* Bug Analysis Focus */}
          {analysisType !== 'Security Only' && (
            <div className="rounded-lg border border-[#1e2642] bg-[#0e1428] p-4">
              <p className="text-sm font-semibold text-[#dbe2ef]">Bug Analysis Focus</p>
              <div className="mt-3 space-y-2">
                {bugFocusOptions.map((option) => (
                  <label key={option} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      readOnly
                    checked={bugFocus.includes(option)}
                      disabled
                      className="h-4 w-4 rounded border-[#2b3558] accent-[#34d399]"
                    />
                    <span className="text-sm text-[#b9c2d6]">{option}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Security Analysis Focus */}
          {analysisType !== 'Bugs Only' && (
            <div className="rounded-lg border border-[#1e2642] bg-[#0e1428] p-4">
              <p className="text-sm font-semibold text-[#dbe2ef]">Security Analysis Focus</p>
              <div className="mt-3 space-y-2">
                {securityFocusOptions.map((option) => (
                  <label key={option} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      readOnly
                    checked={securityFocus.includes(option)}
                      disabled
                      className="h-4 w-4 rounded border-[#2b3558] accent-[#34d399]"
                    />
                    <span className="text-sm text-[#b9c2d6]">{option}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <p id="analysis-unavailable" role="note" className="text-sm text-[#fbbf24]">Bugs Only, Security Only and Full Analysis support Entire Project and Single File analysis. Folder and detailed focus options are unavailable. Files are reviewed individually; cross-file dependencies are not analyzed.</p>
          {submissionError && <p role="alert" className="text-sm text-red-400">{submissionError} {scope==='Single File' ? 'Check saved history before retrying: single-file requests do not support server idempotency.' : 'Retrying unchanged inputs reuses the request key. Check saved history before a new analysis.'}</p>}
          {scope==='Entire Project' && projectId && <section aria-label="Analysis preview" className="space-y-2 text-sm text-[#b9c2d6]">
            {!currentPreview && <p role="status">Loading project preview...</p>}
            {currentPreview?.error && <p role="alert">{currentPreview.error}</p>}
            {data && <><p>Discovered {data.totalDiscoveredFiles} ? Eligible candidates {data.eligibleCandidateCount} ? Known excluded {data.knownSkippedFileCount}</p>{!data.eligibleCandidateCount && <p>No eligible source files to analyze.</p>}<ul>{data.skipReasons.map((reason)=><li key={reason.code}>{reason.count}: {reason.message}</li>)}</ul></>}
            <p>Preliminary eligibility; the worker validates each source file again. Limits: 200 files / 10 MiB, 50,000 characters per reviewed file.</p>
            <button type="button" disabled={submitting || !currentPreview} onClick={()=>setPreviewRetry((n)=>n+1)} className="text-[#34d399] underline">Refresh preview</button>
          </section>}
          {/* Submit Button */}
          <div className="flex gap-3 border-t border-[#1e2642] pt-5">
            <button
              type="button"
              disabled={submitting} onClick={onClose}
              className="flex-1 rounded-lg border border-[#2b3558] px-4 py-3 text-sm font-bold text-[#b9c2d6] transition hover:bg-[#1a2340]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!ready || submitting}
              aria-describedby="analysis-unavailable"
              className="flex-1 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting analysis...' : 'Run Analysis'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AnalysisModal({isOpen,onClose,onStart}) {
  const email=useAuthStore((state)=>state.user?.email)
  return isOpen ? <AnalysisForm key={email || 'signed-out'} onClose={onClose} onStart={onStart}/> : null
}
