import {Plus} from 'lucide-react'
import {useEffect,useRef,useState} from 'react'
import DocumentTypes from '../components/documentation/DocumentTypes'
import GenerateDocumentationModal from '../components/documentation/GenerateDocumentationModal'
import DocumentPreview from '../components/documentation/DocumentPreview'
import {workspaceApi,projectDocumentsApi,isMockToken} from '../services/api'
import {useAuthStore} from '../store/authStore'
import {ACCEPTED_DOCUMENT_TYPES,canGenerateDocumentType,documentTypeLabel,isLegacyDocumentType} from '../data/documentationTypes'
import {newGenerationRequest,generationErrorMessage,generationOutcomeUnknown} from '../data/documentationRequests'

const panel='rounded-xl border border-[#232c4b] bg-[#121a2e] p-5'
const button='rounded-lg border border-[#354368] px-3 py-2 text-sm text-[#6ee7b7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24] disabled:opacity-50'
function validateDocument(doc,projectId,content=false) {
 if(!doc||typeof doc.id!=='string'||!doc.id||doc.id.length>80||doc.projectId!==projectId||typeof doc.title!=='string'||typeof doc.documentType!=='string'||!['Draft','Pending','Running','Completed','Failed'].includes(doc.generationStatus)||(content&&typeof doc.markdown!=='string'))throw Error('Invalid or cross-project document response.')
 if(doc.sourceReferences!==undefined&&(!Array.isArray(doc.sourceReferences)||doc.sourceReferences.length>200||new Set(doc.sourceReferences.map(ref=>ref?.fileId)).size!==doc.sourceReferences.length||doc.sourceReferences.some(ref=>!ref||typeof ref.fileId!=='string'||typeof ref.path!=='string'||typeof ref.hash!=='string'||(ref.lineRanges!==undefined&&(!Array.isArray(ref.lineRanges)||ref.lineRanges.length>60||ref.lineRanges.some(range=>!Number.isInteger(range.lineStart)||!Number.isInteger(range.lineEnd)||range.lineStart<1||range.lineEnd<range.lineStart))))))throw Error('Invalid saved source references.')
 if(doc.coverage!==undefined&&(!doc.coverage||['filesSubmitted','filesIncluded','filesSkipped','filesFailed'].some(key=>!Number.isInteger(doc.coverage[key])||doc.coverage[key]<0||doc.coverage[key]>200)||typeof doc.coverage.truncated!=='boolean'))throw Error('Invalid saved coverage metadata.')
 return doc
}
function date(value){const parsed=new Date(value);return value&&!Number.isNaN(parsed.valueOf())?parsed.toLocaleString():'Date unavailable'}
function message(err,fallback){return err.name==='TimeoutError'||err.name==='AbortError'?'Request timed out.':err.status?err.message:fallback}
function ProjectDocuments({token,projectId,projects,setProjectId,documentType,setDocumentType,modal,setModal,busy,setBusy,acceptedTypes,operation,setOperation,api}){
 const [history,setHistory]=useState(null),[historyError,setHistoryError]=useState(''),[loading,setLoading]=useState(false),[offset,setOffset]=useState(0)
 const [generationState,setGenerationState]=useState(operation?.state||'Ready'),[generationError,setGenerationError]=useState(''),[denied,setDenied]=useState(false)
 const [preview,setPreview]=useState(null),[previewError,setPreviewError]=useState(''),[previewLoading,setPreviewLoading]=useState(false)
 const [downloading,setDownloading]=useState(false),[downloadError,setDownloadError]=useState(''),[checking,setChecking]=useState(false)
 const [pdfExporting,setPdfExporting]=useState(false),[pdfError,setPdfError]=useState('')
 const pdfInFlight=useRef(false),inFlight=useRef(false),historySequence=useRef(0),detailSequence=useRef(0),alive=useRef(true),operationRef=useRef(operation)
 useEffect(()=>{operationRef.current=operation},[operation])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 function remember(value){operationRef.current=value;setOperation(value)}
 function acceptStatus(doc,full=false){
  const pending=operationRef.current
  if(!pending||doc.projectId!==pending.request.projectId||doc.documentType!==pending.request.documentType||(pending.documentId&&doc.id!==pending.documentId))throw Error('Generation identity could not be confirmed.')
  if(!['Pending','Running','Completed','Failed'].includes(doc.generationStatus))throw Error('Unexpected generation state.')
  setGenerationState(doc.generationStatus)
  if(['Completed','Failed'].includes(doc.generationStatus)){
   remember(null)
   if(doc.generationStatus==='Completed'){setGenerationError('');if(full)setPreview(doc);setModal(false)}
   else setGenerationError(`Saved generation failed${doc.failureCode?`: ${doc.failureCode}`:'.'} Review the saved record before starting again.`)
  }else remember({...pending,documentId:doc.id,state:doc.generationStatus})
 }
 async function loadHistory(signal,requestedOffset=offset){
  const sequence=++historySequence.current
  setLoading(true);setHistoryError('')
  try{
   const data=await api.list(token,projectId,requestedOffset,signal)
   if(!Array.isArray(data.documents)||data.documents.length>20||!Number.isInteger(data.total)||data.total<0||data.limit!==20||data.offset!==requestedOffset)throw Error('Invalid document history response.')
   data.documents.forEach(doc=>validateDocument(doc,projectId))
   if(alive.current&&sequence===historySequence.current){
    setHistory(data);setDenied(false)
    const pending=operationRef.current
    const match=pending?.documentId&&data.documents.find(doc=>doc.id===pending.documentId&&doc.documentType===pending.request.documentType)
    if(match)acceptStatus(match)
   }
   return data
  }catch(err){
   if(alive.current&&sequence===historySequence.current&&(!signal?.aborted||signal.reason?.name==='TimeoutError')){
    setHistory(null);setHistoryError(err.status?err.message:'Could not load saved documentation. Retry history loading.')
    if([401,403,404].includes(err.status)){setDenied(true);setPreview(null)}
   }
   throw err
  }finally{if(alive.current&&sequence===historySequence.current)setLoading(false)}
 }
 useEffect(()=>{
  const controller=new AbortController()
  loadHistory(AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).catch(()=>{})
  return()=>controller.abort()
 // Project/token changes remount this component; request identities stay in the session map.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[offset])
 const active=history?.documents.some(doc=>['Pending','Running'].includes(doc.generationStatus))
 const retry=operation?.state==='Unconfirmed'
 const disabled=busy||checking||loading||!history||!!historyError||denied||!canGenerateDocumentType(documentType,acceptedTypes)||(operation?!retry:active)
 async function generate(){
  if(inFlight.current||disabled)return
  const retained=operationRef.current
  let submission
  try{
   submission=retained?.request||newGenerationRequest(projectId,documentType)
   if(submission.projectId!==projectId||submission.documentType!==documentType||!canGenerateDocumentType(submission.documentType,acceptedTypes))throw Error('Return to the original request project and type before retrying.')
  }catch(err){setGenerationError(err.message);return}
  inFlight.current=true;setBusy(true);setGenerationState('Pending');setGenerationError('');setPreviewError('');setPreview(null)
  remember({request:submission,documentId:retained?.documentId||null,state:'Pending'})
  try{
   const data=await api.generate(token,submission)
   const doc=validateDocument(data.document,projectId,true)
   if(!alive.current)return
   acceptStatus(doc,true)
   setOffset(0);await loadHistory(undefined,0).catch(()=>{})
  }catch(err){
   if(!alive.current)return
   const unknown=generationOutcomeUnknown(err)
   const documentId=typeof err.data?.documentId==='string'?err.data.documentId:operationRef.current?.documentId
   if(unknown){remember({request:submission,documentId:documentId||null,state:'Unconfirmed'});setGenerationState('Unconfirmed')}
   else{remember(null);setGenerationState('Failed')}
   setGenerationError(generationErrorMessage(err)+(unknown?' No automatic retry was made. Retry this identical request with its original ID; do not start a different generation.':''))
   if(err.data?.failurePersisted===false)setGenerationError(previous=>`${previous} Failed status could not be confirmed as saved.`)
   if([401,403,404].includes(err.status)){setDenied(true);setPreview(null)}
   setOffset(0);await loadHistory(undefined,0).catch(()=>{})
  }finally{inFlight.current=false;if(alive.current)setBusy(false)}
 }
 async function checkStatus(){
  const pending=operationRef.current
  if(!pending?.documentId||checking||busy)return
  setChecking(true)
  try{const data=await api.get(token,pending.documentId);const doc=validateDocument(data.document,projectId,true);if(alive.current){acceptStatus(doc,true);setOffset(0);await loadHistory(undefined,0).catch(()=>{})}}
  catch(err){if(alive.current){setGenerationError(message(err,'Could not confirm the saved generation status.'));if([401,403,404].includes(err.status)){setDenied(true);setPreview(null);setHistory(null)}}}
  finally{if(alive.current)setChecking(false)}
 }
 async function view(id) {
  const sequence=++detailSequence.current
  setPreview(null);setPreviewError('');setPreviewLoading(true);setDownloadError('');setPdfError('')
  try {const data=await api.get(token,id);const doc=validateDocument(data.document,projectId,true);if(doc.id!==id)throw new Error('Invalid document identity.');if(alive.current && sequence===detailSequence.current)setPreview(doc)}
  catch(err){if(alive.current && sequence===detailSequence.current)setPreviewError(err.status ? err.message : 'Could not load the selected saved document.')}
  finally{if(alive.current && sequence===detailSequence.current)setPreviewLoading(false)}
 }
 async function download() {
  if(downloading || !preview)return
  setDownloading(true);setDownloadError('')
  try {
   const blob=await api.markdown(token,preview.id)
   if(!alive.current)return
   const url=URL.createObjectURL(blob),link=document.createElement('a')
   link.href=url;link.download=`document-${preview.id}.md`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
  } catch(err){if(alive.current)setDownloadError(message(err,'Could not download Markdown.'))}
  finally{if(alive.current)setDownloading(false)}
 }
 async function downloadPdf() {
  if(pdfInFlight.current || !preview)return
  pdfInFlight.current=true;setPdfExporting(true);setPdfError('')
  try {
   // Re-authorize and reload the saved record before export, including Draft edits.
   const data=await api.get(token,preview.id)
   const saved=validateDocument(data.document,projectId,true)
   if(saved.id!==preview.id)throw new Error('Document identity could not be verified.')
   const project=projects.find(project=>project.id===projectId)
   const {createDocumentPdf,documentPdfFilename}=await import('../services/documentPdf')
   const filename=documentPdfFilename(saved.id)
   const blob=await createDocumentPdf(saved,project)
   if(!alive.current)return
   const url=URL.createObjectURL(blob),link=document.createElement('a')
   link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }catch(err){if(alive.current)setPdfError(err.status ? err.message : 'Could not export PDF. Verify the saved document has content and try again.')}
  finally{pdfInFlight.current=false;if(alive.current)setPdfExporting(false)}
 }
 return <>
  <div className="mt-5 flex flex-wrap items-center gap-3"><p role="status" className="text-sm font-semibold text-[#fbbf24]">Generation: {generationState}</p><button type="button" disabled={loading||busy} onClick={()=>loadHistory().catch(()=>{})} className={button}>Refresh saved history</button>{operation?.documentId&&<button type="button" disabled={checking||busy||denied} onClick={checkStatus} className={button}>{checking?'Checking status...':'Check generation status'}</button>}{operation?.state==='Unconfirmed'&&<button type="button" disabled={busy||denied} onClick={()=>setModal(true)} className={button}>Review unconfirmed request</button>}</div>
  {generationError&&<p role="alert" className="mt-3 text-sm text-red-300">{generationError}</p>}
  {operation&&<p className="mt-3 text-xs leading-relaxed text-[#b9c2d6]">{documentTypeLabel(operation.request.documentType)} request retained for this project. Refresh history or check its saved status. Closing the dialog does not cancel server work.</p>}
  {active&&<p className="mt-3 text-sm text-[#8f99b0]">A saved generation is Pending or Running. Refresh history to check its outcome before submitting again. Navigation does not cancel backend work.</p>}
  <DocumentTypes acceptedTypes={acceptedTypes} available={!disabled&&!operation} onGenerateClick={id=>{if(!operation&&canGenerateDocumentType(id,acceptedTypes)){setDocumentType(id);setModal(true)}}}/>
  <div className="mt-8 grid gap-6 lg:grid-cols-3">
   <section aria-label="Saved documentation" className={`${panel} lg:col-span-2`}><h2 className="text-xl font-bold text-[#eef1f8]">Saved Documentation</h2>
    {loading&&<p role="status" className="mt-4 text-sm text-[#8f99b0]">Loading saved documentation...</p>}
    {historyError&&<p role="alert" className="mt-4 text-sm text-red-300">{historyError}</p>}
    {!loading&&history?.documents.length===0&&<p className="mt-4 text-sm text-[#8f99b0]">No saved documentation for this project.</p>}
    {!loading&&history&&<><p className="mt-3 text-xs text-[#8f99b0]">{history.total} saved records in this project. Showing {history.documents.length} on this page.</p><ul className="mt-4 space-y-3">{history.documents.map(doc=><li key={doc.id} className="rounded-lg border border-[#283455] p-4"><button type="button" disabled={previewLoading||busy} onClick={()=>view(doc.id)} className="font-semibold text-[#6ee7b7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24]">{doc.title}</button><p className="mt-2 text-xs text-[#b9c2d6]">{documentTypeLabel(doc.documentType)} ? {doc.generationStatus} ? Created {date(doc.createdAt)}</p>{isLegacyDocumentType(doc.documentType)&&<p className="mt-2 text-xs text-[#8f99b0]">Historical type: {doc.documentType}</p>}{doc.provider&&<p className="mt-2 text-xs text-[#8f99b0]">Provider: {doc.provider}{doc.model?` / ${doc.model}`:''}</p>}{doc.failureCode&&<p className="mt-2 text-xs text-red-300">Failure: {doc.failureCode}</p>}</li>)}</ul><div className="mt-4 flex gap-3"><button type="button" className={button} disabled={offset===0||busy||loading} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous documents</button><button type="button" className={button} disabled={offset+history.documents.length>=history.total||offset>=100000||busy||loading} onClick={()=>setOffset(offset+20)}>Next documents</button></div></>}
   </section>
   <aside aria-label="Documentation coverage" className={panel}><h2 className="text-xl font-bold text-[#eef1f8]">Evidence and coverage</h2><p className="mt-4 text-sm leading-relaxed text-[#8f99b0]">Select a saved document to inspect its source snapshots and input coverage. Verified artifacts, static candidates, inferred relationships and declared but untested commands retain their labels in the saved content.</p><p className="mt-3 text-sm text-[#8f99b0]">Unavailable evidence is shown explicitly. No project-wide coverage percentage or runtime guarantee is inferred.</p></aside>
  </div>
  {previewLoading&&<p role="status" className="mt-6 text-sm text-[#8f99b0]">Loading saved document...</p>}
  {previewError&&<p role="alert" className="mt-6 text-sm text-red-300">{previewError}</p>}
  {preview&&<div className="mt-6"><DocumentPreview document={preview} onBack={()=>setPreview(null)} onDownload={download} downloading={downloading} downloadError={downloadError} onDownloadPdf={downloadPdf} pdfExporting={pdfExporting} pdfError={pdfError}/></div>}
  <GenerateDocumentationModal isOpen={modal} onClose={()=>setModal(false)} projects={projects} projectId={projectId} onProjectChange={setProjectId} documentType={documentType} onTypeChange={setDocumentType} onGenerate={generate} busy={busy} disabled={disabled} acceptedTypes={acceptedTypes} operation={operation} error={generationError||historyError||(active&&!retry?'A saved generation is still active. Refresh saved history before submitting again.':'')}/>
 </>
}
// Test fixtures can supply an isolated API and acceptance policy. The production
// route always uses these safe defaults; no network/config/storage override exists.
export function DocumentationSession({token,acceptedTypes=ACCEPTED_DOCUMENT_TYPES,api=projectDocumentsApi,loadProjects=workspaceApi.projects}){
 const [projects,setProjects]=useState(null),[projectId,setProjectId]=useState(''),[documentType,setDocumentType]=useState('project-overview'),[error,setError]=useState(''),[retry,setRetry]=useState(0),[modal,setModal]=useState(false),[busy,setBusy]=useState(false)
 const operations=useRef(new Map()),[operationStates,setOperationStates]=useState(()=>new Map())
 function remember(project,value){if(value)operations.current.set(project,value);else operations.current.delete(project);setOperationStates(new Map(operations.current))}
 function chooseProject(value){if(busy)return;setProjectId(value);const pending=operations.current.get(value);if(pending)setDocumentType(pending.request.documentType)}
 useEffect(()=>{
  if(isMockToken(token))return
  const controller=new AbortController()
  loadProjects(token,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then(data=>{
   if(controller.signal.aborted)return
   if(!Array.isArray(data.projects)||data.projects.some(project=>!project||typeof project.id!=='string'||!project.id||typeof project.name!=='string')||new Set(data.projects.map(project=>project.id)).size!==data.projects.length)throw Error('Invalid project listing response.')
   setProjects(data.projects);setProjectId(data.projects[0]?.id||'')
  }).catch(err=>{if(!controller.signal.aborted)setError(err.status?err.message:err.message==='Invalid project listing response.'?err.message:'Could not load owned projects.')})
  return()=>controller.abort()
 },[token,retry,loadProjects])
 return <section className="mx-auto w-full max-w-[1440px] min-w-0 px-5 py-8 sm:px-8 lg:py-10">
  <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">Documentation</p><h2 className="text-3xl font-bold tracking-tight text-[#eef1f8] sm:text-4xl">Project Documentation</h2><p className="mt-2 text-sm text-[#8f99b0]">Source-grounded documents, saved evidence and secure exports.</p></div><button type="button" onClick={()=>setModal(true)} className="rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24]"><Plus size={17} className="mr-2 inline"/>Documentation Setup</button></div>
  {acceptedTypes.length<9&&<div className="mb-5 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm leading-relaxed text-[#dbe2ef]"><p className="font-semibold text-[#fbbf24]">Additional types are pending acceptance</p><p className="mt-1">Project Overview retains its existing workflow. The eight additional types remain unavailable for generation until their rollout is verified. Registry entries alone do not confirm readiness.</p></div>}
  <div className={panel}><label htmlFor="documentation-project" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Documentation project</label><select id="documentation-project" value={projectId} disabled={busy||!projects?.length||!!error} onChange={event=>chooseProject(event.target.value)} className="w-full rounded-lg border border-[#354368] bg-[#121a2e] px-3 py-2.5 text-sm text-[#eef1f8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24]">{(projects||[]).map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select>
   {isMockToken(token)?<p role="alert" className="mt-3 text-sm text-red-300">Sign in to load your owned projects.</p>:<>{!projects&&!error&&<p role="status" className="mt-3 text-sm text-[#8f99b0]">Loading owned projects...</p>}{error&&<div><p role="alert" className="mt-3 text-sm text-red-300">{error}</p><button type="button" className={`${button} mt-3`} onClick={()=>{setError('');setProjects(null);setProjectId('');setRetry(n=>n+1)}}>Retry project loading</button></div>}{projects?.length===0&&<p className="mt-3 text-sm text-[#8f99b0]">No owned projects found. Create a project and upload source in Workspace.</p>}</>}
  </div>
  {projectId&&!error?<ProjectDocuments key={`${token}:${projectId}`} token={token} projectId={projectId} projects={projects} setProjectId={chooseProject} documentType={documentType} setDocumentType={setDocumentType} modal={modal} setModal={setModal} busy={busy} setBusy={setBusy} acceptedTypes={acceptedTypes} api={api} operation={operationStates.get(projectId)||null} setOperation={value=>remember(projectId,value)}/>:<><DocumentTypes available={false} acceptedTypes={acceptedTypes}/><GenerateDocumentationModal isOpen={modal} onClose={()=>setModal(false)} projects={projects} projectId={projectId} onProjectChange={chooseProject} documentType={documentType} onTypeChange={setDocumentType} acceptedTypes={acceptedTypes} disabled error={error||'Select an owned project before generating.'}/></>}
 </section>
}
export default function DocumentationPage(){const token=useAuthStore(state=>state.token);return <DocumentationSession key={token||'signed-out'} token={token}/>}
