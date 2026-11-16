import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import AnalysisModal from '../components/security/AnalysisModal'
import FindingCard from '../components/security/FindingCard'
import FindingDetails from '../components/security/FindingDetails'
import BatchProgress from '../components/codeReview/BatchProgress'
import { repositoryReviewBatchesApi as batchesApi, repositoryReviewsApi, isMockToken } from '../services/api'
import { useAuthStore } from '../store/authStore'
const focusLabel=(focus)=>focus==='BugsAndSecurity' ? 'Full Analysis' : focus
const isAnalysis=(batch)=>(batch?.scope==='Entire Project' || batch?.coverage?.scope==='Single File') && ['Bugs','Security','BugsAndSecurity'].includes(batch.options?.focus)
function validateBatch(batch,expectedFocus){
  if(!batch?.id || !isAnalysis(batch) || (expectedFocus && batch.options.focus!==expectedFocus) || !Array.isArray(batch.findings) || batch.findings.length>50 || !Array.isArray(batch.files) || !batch.coverage || !batch.findingsPage)throw new Error('Invalid repository analysis response. Saved results could not be verified.')
  return batch
}
function singleAnalysis(review,expectedFocus){
  if(!review?.id || review.coverage?.scope!=='Single File' || !isAnalysis(review) || (expectedFocus && review.options.focus!==expectedFocus) || !Array.isArray(review.findings) || review.findings.length>20)throw new Error('Invalid single-file analysis response.')
  return {...review,analysisKind:'single',scope:'Single File',files:[],findingsPage:null,findings:review.findings.map((finding)=>({...finding,reviewId:review.id})),findingsCount:review.findings.length}
}
function singleHistory(review){return {...review,analysisKind:'single',scope:'Single File'}}
function SecurityContent(){
  const token=useAuthStore((s)=>s.token)
  const [modal,setModal]=useState(false),[history,setHistory]=useState(null),[selectedId,setSelectedId]=useState('')
  const [historyFocus,setHistoryFocus]=useState('Bugs')
  const [projectId,setProjectId]=useState(''),[record,setRecord]=useState(null),[offset,setOffset]=useState(0)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[evidence,setEvidence]=useState(null),[evidenceLoading,setEvidenceLoading]=useState(false)
  const [findingId,setFindingId]=useState(''),[saving,setSaving]=useState(false)
  const [filters,setFilters]=useState({severity:'All',type:'All',status:'All'}),[query,setQuery]=useState('')
  const revision=useRef(0),submissionBusy=useRef(false),triageBusy=useRef(false)
  useEffect(()=>{
    let cancelled=false
    const version=revision.current
    if(isMockToken(token))return
    Promise.allSettled([batchesApi.list(token),repositoryReviewsApi.list(token)]).then(([batches,singles])=>{
      if(cancelled || version!==revision.current)return
      const batchRows=batches.status==='fulfilled' && Array.isArray(batches.value.batches) ? batches.value.batches.filter(isAnalysis) : []
      const singleRows=singles.status==='fulfilled' && Array.isArray(singles.value.reviews) ? singles.value.reviews.filter((review)=>review.coverage?.scope==='Single File' && isAnalysis(review)).map(singleHistory) : []
      const failures=[batches,singles].filter((result)=>result.status==='rejected').map((result)=>result.reason.message)
      if(batches.status==='fulfilled' && !Array.isArray(batches.value.batches))failures.push('Invalid batch history response.')
      if(singles.status==='fulfilled' && !Array.isArray(singles.value.reviews))failures.push('Invalid single-file history response.')
      if(failures.length)setError(failures.join(' '))
      const knownChildren=new Set([...batchRows.flatMap((row)=>[...(row.files || []).map((file)=>file.reviewId), ...(row.childReviewIds || [])]), ...singleRows.filter((row)=>row.coverage?.batchId).map((row)=>row.id)].filter(Boolean))
      const saved=[...batchRows,...singleRows.filter((row)=>!knownChildren.has(row.id))].sort((a,b)=>Date.parse(b.createdAt || 0)-Date.parse(a.createdAt || 0))
      setHistory(saved);setHistoryFocus(saved[0]?.options.focus || 'Bugs');setSelectedId(saved[0]?.id || '');setProjectId(saved[0]?.projectId || '')
    }).catch((err)=>{if(!cancelled)setError(err.message || 'Could not load analysis history.')})
    return ()=>{cancelled=true}
  },[token])
  const selectedKind=history?.find((item)=>item.id===selectedId)?.analysisKind
  useEffect(()=>{
    if(!selectedId || isMockToken(token))return
    let cancelled=false,busy=false,terminal=false
    async function load(){
      if(busy || terminal || triageBusy.current)return
      busy=true
      const version=revision.current
      try{
        const batch=selectedKind==='single' ? singleAnalysis((await repositoryReviewsApi.get(token,selectedId,AbortSignal.timeout(15000))).review) : validateBatch((await batchesApi.get(token,selectedId,offset)).batch)
        if(cancelled || version!==revision.current)return
        terminal=['Completed','Partial','Failed'].includes(batch.status)
        setRecord({batch,offset});setHistory((items)=>(items || []).filter((item)=>item.analysisKind!=='single' || !batch.files.some((file)=>file.reviewId===item.id)).map((item)=>item.id===batch.id ? batch : item));setFindingId((id)=>batch.findings.some((f)=>f.id===id) ? id : batch.findings[0]?.id || '')
      }catch(err){if(!cancelled && version===revision.current)setError(`Analysis could not be refreshed: ${err.message}. Saved work continues.`)}
      finally{busy=false}
    }
    load()
    const timer=setInterval(()=>{load()},15000)
    return ()=>{cancelled=true;clearInterval(timer)}
  },[token,selectedId,offset,selectedKind])
  const batch=record?.batch.id===selectedId && record.offset===offset ? record.batch : null
  const finishedTimes=(batch?.files || []).map((file)=>Date.parse(file.finishedAt))
  const completedAt=batch && ['Completed','Partial','Failed'].includes(batch.status) && finishedTimes.length>0 && finishedTimes.every(Number.isFinite) ? new Date(Math.max(...finishedTimes)).toLocaleString() : null
  const findings=batch?.findings || []
  const selected=findings.find((f)=>f.id===findingId)
  const display=selected ? {...selected,type:selected.findingType ?? 'Unclassified',title:selected.problem,recommendation:selected.improvement,...(evidence?.id===selected.id && evidence.reviewId===selected.reviewId ? {code:evidence.code,suggestedCode:evidence.suggestedCode} : {})} : null
  const visible=findings.filter((f)=>(filters.severity==='All'||f.severity===filters.severity)&&(filters.type==='All'||(f.findingType ?? 'Unclassified')===filters.type)&&(filters.status==='All'||f.status===filters.status)&&`${f.problem} ${f.file} ${f.category}`.toLowerCase().includes(query.toLowerCase()))
  function choose(id){revision.current++;setSelectedId(id);setRecord(null);setOffset(0);setEvidence(null);setFindingId('');setError('');setNotice('');setFilters({severity:'All',type:'All',status:'All'})}
  async function start(payload){
    if(submissionBusy.current)throw new Error('An analysis submission is already in progress.')
    submissionBusy.current=true;revision.current++
    try{
      const batch=payload.fileId ? singleAnalysis((await repositoryReviewsApi.create(token,payload)).review,payload.options.focus) : validateBatch((await batchesApi.create(token,payload)).batch,payload.options.focus)
      setHistory((items)=>[batch,...(items || []).filter((item)=>item.id!==batch.id)]);setProjectId(batch.projectId);setHistoryFocus(batch.options.focus);choose(batch.id);setRecord({batch,offset:0});setModal(false)
    }finally{submissionBusy.current=false}
  }
  async function loadEvidence(){
    if(!selected || evidenceLoading)return
    const target=selected,version=revision.current
    setEvidenceLoading(true);setError('')
    try{
      const child=(await repositoryReviewsApi.get(token,target.reviewId,AbortSignal.timeout(15000))).review
      const finding=child?.findings?.find((f)=>f.id===target.id)
      if(!finding || finding.file!==target.file || finding.line!==target.line)throw new Error('Source evidence could not be verified.')
      if(version===revision.current)setEvidence({...finding,reviewId:target.reviewId})
    }catch(err){if(version===revision.current)setError(err.message)}finally{setEvidenceLoading(false)}
  }
  async function triage(finding,status){
    if(triageBusy.current)return
    triageBusy.current=true;setSaving(true);setError('');setNotice('')
    const version=++revision.current
    try{
      const child=(await repositoryReviewsApi.triage(token,finding.reviewId,finding.id,status,AbortSignal.timeout(15000))).review
      const saved=child?.findings?.find((f)=>f.id===finding.id)
      if(saved?.status!==status)throw new Error('Finding status was not confirmed by the server.')
      if(version!==revision.current)return
      setRecord((current)=>({...current,batch:{...current.batch,findings:current.batch.findings.map((f)=>f.id===finding.id ? {...f,status:saved.status} : f)}}));setNotice('Finding status saved.')
    }catch(err){if(version===revision.current)setError(`Finding status was not saved. Previous status retained. ${err.message}`)}
    finally{triageBusy.current=false;setSaving(false)}
  }
  const projects=[...new Map((history || []).map((b)=>[b.projectId,b.project])).entries()]
  const historyForProject=(history || []).filter((b)=>b.projectId===projectId && b.options.focus===historyFocus)
  return <section className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 text-[#b9c2d6]">
    <div className="mb-8 flex flex-wrap justify-between gap-4"><div><h2 className="text-3xl font-bold text-[#eef1f8]">Bugs &amp; Security</h2><p className="mt-2 text-sm text-[#8f99b0]">Saved Gemini Bugs and Security analyses. Potential findings require developer verification.</p></div><button type="button" onClick={()=>setModal(true)} className="rounded-lg bg-[#f59e0b] px-4 py-3 font-bold text-[#231303]"><Plus className="mr-2 inline" size={17}/>Run Analysis</button></div>
    {isMockToken(token) && <p role="alert">Sign in to access your saved analyses.</p>}
    {error && <p role="alert" className="my-4 rounded-lg border border-red-400/30 p-3 text-red-400">{error}</p>}
    {notice && <p role="status" className="my-3 text-[#34d399]">{notice}</p>}
    {history===null && !error && !isMockToken(token) && <p role="status">Loading saved analysis history...</p>}
    <section aria-label="Analysis history" className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5">
      <h3 className="text-xl font-bold">Saved analyses</h3><p className="my-2 text-xs text-[#8f99b0]">Latest 100 batches and 100 single-file reviews are available; this view shows Entire Project and Single File analyses, separated by focus. Single-file history can include saved child reviews from batches. Each run is a separate snapshot.</p>
      {!!projects.length && <label>History project<select aria-label="History project" value={projectId} onChange={(e)=>{setProjectId(e.target.value);choose((history || []).find((b)=>b.projectId===e.target.value && b.options.focus===historyFocus)?.id || '')}} className="ml-3 rounded bg-[#0e1428] p-2">{projects.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}
      <div aria-label="Analysis history focus" className="mt-4 flex gap-3">{['Bugs','Security','BugsAndSecurity'].map((focus)=><button key={focus} type="button" aria-pressed={historyFocus===focus} onClick={()=>{setHistoryFocus(focus);choose((history || []).find((b)=>b.projectId===projectId && b.options.focus===focus)?.id || '')}} className="rounded-lg border border-[#232c4b] px-4 py-2">{focus==='BugsAndSecurity' ? 'Full Analysis' : `${focus} analyses`}</button>)}</div>
      {!!history?.length && !historyForProject.length && <p className="mt-3">No saved {focusLabel(historyFocus)} runs for this project.</p>}
      <ul className="mt-4 max-h-60 overflow-auto space-y-2">{historyForProject.map((b)=><li key={b.id}><button type="button" aria-pressed={b.id===selectedId} onClick={()=>choose(b.id)} className="w-full rounded-lg border border-[#232c4b] p-3 text-left">{b.project} · {b.analysisKind==='single' ? `Single File: ${b.file}` : 'Entire Project'} · {focusLabel(b.options.focus)} · {b.status} · {b.findingsCount} saved findings{b.createdAt ? ` · ${new Date(b.createdAt).toLocaleString()}` : ''}</button></li>)}</ul>
      {history?.length===0 && !error && <p className="mt-4">No saved Bugs, Security or Full analyses. Run an analysis to begin.</p>}
    </section>
    {batch && <><p className="mt-4">Selected project: {batch.project} · Scope: {batch.scope} · Focus: {focusLabel(batch.options.focus)}</p>{batch.analysisKind!=='single' ? <BatchProgress review={{...batch,reviewScope:batch.scope}}/> : <section aria-label="Single file progress" className="mt-4 rounded-xl border border-[#232c4b] bg-[#121a2e] p-5"><h3>Single File: {batch.status}</h3><p className="mt-2 font-mono">{batch.file}</p><p>Files reviewed: {batch.coverage.filesReviewed} ? Source lines: {batch.coverage.lines}</p>{batch.errorCode && <p role="alert">Saved review failed ({batch.errorCode}). No successful result is claimed.</p>}</section>}{['Completed','Partial','Failed'].includes(batch.status) && <p className="mt-2 text-xs">{completedAt ? `Analysis finalized: ${completedAt}.` : batch.updatedAt ? `Last persisted update: ${new Date(batch.updatedAt).toLocaleString()}.` : 'Completion timestamp is not supplied by this API.'}</p>}
      <section aria-label="Analysis metrics" className="my-6 grid gap-3 sm:grid-cols-3"><p>Total {batch.analysisKind==='single' ? 'review' : 'batch'} findings: {batch.findingsCount}</p><p>Bugs on loaded page: {findings.filter((f)=>f.findingType==='Bug').length}</p><p>Security on loaded page: {findings.filter((f)=>f.findingType==='Security').length}</p><p>Unclassified on loaded page: {findings.filter((f)=>f.findingType===null).length}</p></section>
    </>}
    {selectedId && !batch && !error && <p role="status">Loading saved findings...</p>}
    <div className="mt-6 grid gap-6 xl:grid-cols-2"><section className="min-w-0 rounded-xl border border-[#232c4b] bg-[#121a2e] p-5"><h3 className="text-xl font-bold">Review Findings</h3><p className="my-3 text-xs text-[#8f99b0]">Counts, search and filters apply only to this loaded page. Zero findings does not guarantee bug-free or secure code.</p>
      {batch?.findingsPage && <nav aria-label="Finding pagination" className="my-4 flex flex-wrap gap-3 text-sm"><span>Page {Math.floor(offset/50)+1} of {Math.max(1,Math.ceil(batch.findingsPage.total/50))}</span><button disabled={offset===0} onClick={()=>{revision.current++;setOffset(Math.max(0,offset-50));setRecord(null);setEvidence(null);setError('')}}>Previous findings page</button><button disabled={!batch.findingsPage.hasMore} onClick={()=>{revision.current++;setOffset(batch.findingsPage.nextOffset);setRecord(null);setEvidence(null);setError('')}}>Next findings page</button></nav>}
      <label className="block text-sm">Search loaded findings<input aria-label="Search loaded findings" value={query} onChange={(e)=>setQuery(e.target.value)} className="mt-2 w-full rounded bg-[#0e1428] p-2"/></label>
      <div className="my-4 flex flex-wrap gap-3">{Object.entries({severity:['All','Critical','High','Medium','Low','Info'],type:['All','Bug','Security','Unclassified'],status:['All','Open','Reviewed','False Positive','Fixed']}).map(([key,values])=><label key={key} className="text-sm">{key}<select aria-label={`Filter by ${key}`} value={filters[key]} onChange={(e)=>setFilters((f)=>({...f,[key]:e.target.value}))} className="ml-2 rounded bg-[#0e1428] p-2">{values.map((value)=><option key={value}>{value}</option>)}</select></label>)}</div>
      {batch && <p className="mb-3 text-xs">Loaded page: {findings.length} findings · {visible.length} shown. Severity: {['Critical','High','Medium','Low','Info'].map((level)=>`${level} ${findings.filter((f)=>f.severity===level).length}`).join(' · ')}</p>}
      <div className="space-y-3">{visible.map((f)=><FindingCard key={f.id} finding={{...f,type:f.findingType ?? 'Unclassified',title:f.problem}} selected={f.id===findingId} statusSaving={saving} onSelect={()=>setFindingId(f.id)} onStatusChange={(status)=>triage(f,status)}/>)}</div>
      {batch && !visible.length && <p className="my-5">{findings.length ? 'No findings match the loaded-page filters.' : ['Queued','In Progress'].includes(batch.status) ? 'Analysis is still running. Saved results refresh automatically.' : batch.status==='Failed' ? 'No files were successfully reviewed. Inspect failures and skips.' : batch.status==='Partial' ? 'No findings recorded for reviewed files. Some files were not analyzed.' : batch.options.focus==='Security' ? 'No security findings recorded. This does not establish that the project is secure.' : batch.options.focus==='BugsAndSecurity' ? 'No findings recorded. This does not establish that the project is bug-free or secure.' : 'No findings recorded. This does not establish that the project is bug-free.'}</p>}
    </section><section className="min-w-0">{display && display.code===undefined && <button type="button" disabled={evidenceLoading} onClick={loadEvidence} className="mb-3 text-sm text-[#34d399] underline">{evidenceLoading ? 'Loading evidence...' : 'Load source evidence and suggested fix'}</button>}<FindingDetails finding={display}/></section></div>
    <AnalysisModal isOpen={modal} onClose={()=>setModal(false)} onStart={start}/>
  </section>
}
export default function SecurityPage(){const email=useAuthStore((s)=>s.user?.email);return <SecurityContent key={email || 'signed-out'}/>}
