import {Download,RefreshCw} from 'lucide-react'
import {useEffect,useState} from 'react'
import {reportsApi,isMockToken} from '../services/api'
import {useAuthStore} from '../store/authStore'
import {validateReport,validateReportProjects,severityLabel} from '../data/reports'
import {downloadReportCsv} from '../services/reportExport'
const panel='rounded-xl border border-[#232c4b] bg-[#121a2e] p-5'
const button='inline-flex items-center gap-2 rounded-lg border border-[#354368] px-4 py-2.5 text-sm font-semibold text-[#6ee7b7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24] disabled:opacity-50'
const progress=value=>value===null?'No tasks':`${value}%`
function requestError(error){
 if(error.name==='TimeoutError'||error.name==='AbortError')return 'Reporting request timed out. Retry loading; no data was changed.'
 if(error.data?.code==='reports_unavailable')return 'Persisted reporting data is unavailable. Verify the existing database schema and connection, then retry.'
 if(error.status===404)return 'This project is unavailable or you no longer own it. Refresh the project list.'
 return error.status?error.message:'Could not load persisted reports. Check your connection and retry.'
}
function Report({report}){
 const {tasks,sprints,reviews}=report
 return <>
  <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-[#eef1f8]">{report.project.name}</h2><p className="mt-1 text-sm text-[#b9c2d6]">As of <time dateTime={report.asOf}>{new Date(report.asOf).toLocaleString()}</time></p></div><button type="button" className={button} onClick={()=>downloadReportCsv(report)}><Download size={16} aria-hidden="true"/>Download CSV</button></div>
  <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Total Tasks',tasks.total],['Completed Tasks',tasks.done],['Task Completion',progress(tasks.completionPercent)],['Code Review Findings',reviews.findings.total]].map(([label,value])=><article key={label} className={panel}><h3 className="text-sm text-[#b9c2d6]">{label}</h3><p className="mt-3 text-3xl font-bold tabular-nums text-[#eef1f8]">{value}</p>{label==='Code Review Findings'&&<p className="mt-2 text-xs text-[#8f99b0]">Saved finding occurrences, not unique defects.</p>}</article>)}</div>
  <section aria-label="Task status breakdown" className={`${panel} mt-6`}><h2 className="text-lg font-bold text-[#eef1f8]">Task status</h2><dl className="mt-4 flex flex-wrap gap-8">{[['To Do',tasks.toDo],['In Progress',tasks.inProgress],['Done',tasks.done]].map(([label,value])=><div key={label}><dt className="text-sm text-[#b9c2d6]">{label}</dt><dd className="mt-1 text-xl font-bold text-[#eef1f8]">{value}</dd></div>)}</dl>{!tasks.total&&<p className="mt-3 text-sm text-[#8f99b0]">No tasks have been saved for this project.</p>}</section>
  <section aria-label="Sprint progress" className={`${panel} mt-6`}><h2 className="text-lg font-bold text-[#eef1f8]">Sprint progress</h2>{sprints.length?<div role="region" aria-label="Scrollable sprint progress table" tabIndex={0} className="mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24]"><table className="w-full text-left text-sm text-[#b9c2d6]"><caption className="mb-3 text-left text-xs text-[#8f99b0]">All saved project sprints. Progress uses tasks assigned to each sprint.</caption><thead><tr>{['Sprint name','Sprint status','Assigned tasks','Completed tasks','Progress'].map(label=><th key={label} scope="col" className="whitespace-nowrap border-b border-[#354368] p-3">{label}</th>)}</tr></thead><tbody>{sprints.map(s=><tr key={s.id}><th scope="row" className="border-b border-[#232c4b] p-3 font-medium">{s.name}</th><td className="p-3">{s.status}</td><td className="p-3">{s.total}</td><td className="p-3">{s.done}</td><td className="whitespace-nowrap p-3">{progress(s.completionPercent)}</td></tr>)}</tbody></table></div>:<p className="mt-4 text-sm text-[#8f99b0]">No sprints have been saved for this project.</p>}</section>
  <section aria-label="Saved code review summary" className={`${panel} mt-6`}><h2 className="text-lg font-bold text-[#eef1f8]">Saved code review summary</h2><p className="mt-2 text-sm text-[#8f99b0]">File review records include batch child records once each. Batch counts are separate and are never added to file-review totals. Batches retain their existing owner scope.</p><div className="mt-4 grid gap-5 sm:grid-cols-2">{[['File review records',reviews.fileReviews],['Review batches',reviews.batches]].map(([label,group])=><div key={label}><h3 className="font-semibold text-[#eef1f8]">{label}: {group.total}</h3>{group.byStatus.length?<dl className="mt-2 space-y-2">{group.byStatus.map(row=><div key={row.status} className="flex justify-between gap-4 text-sm text-[#b9c2d6]"><dt>{row.status}</dt><dd>{row.count}</dd></div>)}</dl>:<p className="mt-2 text-sm text-[#8f99b0]">No saved {label.toLowerCase()}.</p>}</div>)}</div><h3 className="mt-6 font-semibold text-[#eef1f8]">Finding occurrences by severity</h3><p className="mt-2 text-xs text-[#8f99b0]">From completed file review records only. Repeated findings across review records count separately. Historical severity labels are preserved.</p><dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{reviews.findings.bySeverity.map(row=><div key={JSON.stringify(row.severity)} className="flex justify-between gap-3 rounded-lg bg-[#0e1428] p-3 text-sm text-[#b9c2d6]"><dt>{severityLabel(row)}</dt><dd className="font-bold">{row.count}</dd></div>)}</dl>{!reviews.findings.total&&<p className="mt-3 text-sm text-[#8f99b0]">No saved finding occurrences in completed reviews.</p>}</section>
 </>
}
function ProjectReport({token,projectId}){
 const [state,setState]=useState({report:null,loading:true,error:''}),[revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController()
  reportsApi.project(token,projectId,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then(data=>{
   if(!controller.signal.aborted)setState({report:validateReport(data,projectId),loading:false,error:''})
  }).catch(error=>{if(!controller.signal.aborted)setState({report:null,loading:false,error:requestError(error)})})
  return()=>controller.abort()
 },[token,projectId,revision])
 return <><div className="mt-5"><button type="button" className={button} disabled={state.loading} onClick={()=>{setState({report:null,loading:true,error:''});setRevision(n=>n+1)}}><RefreshCw size={16} aria-hidden="true"/>{state.error?'Retry report':'Refresh'}</button></div>{state.loading&&<p role="status" className="mt-5 text-sm text-[#b9c2d6]">Loading persisted project report...</p>}{state.error&&<p role="alert" className="mt-5 text-sm text-red-300">{state.error}</p>}{state.report&&!state.loading&&<Report report={state.report}/>}</>
}
function ReportsSession({token}){
 const [state,setState]=useState({projects:null,error:''}),[projectId,setProjectId]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController()
  if(isMockToken(token))return()=>controller.abort()
  reportsApi.projects(token,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then(data=>{
   if(controller.signal.aborted)return
   const projects=validateReportProjects(data)
   setState({projects,error:''});setProjectId(previous=>projects.some(p=>p.id===previous)?previous:projects[0]?.id||'')
  }).catch(error=>{if(!controller.signal.aborted)setState({projects:null,error:requestError(error)})})
  return()=>controller.abort()
 },[token,revision])
 function refreshProjects(){setState({projects:null,error:''});setRevision(n=>n+1)}
 return <section className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 lg:py-10"><p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">Insights</p><h1 className="text-3xl font-bold text-[#eef1f8] sm:text-4xl">Reports</h1><p className="mt-2 text-sm text-[#8f99b0]">Current-state reports from saved project data. Available to project owners only.</p><div className={`${panel} mt-6`}><label htmlFor="report-project" className="mb-2 block text-sm font-semibold text-[#b9c2d6]">Owned project</label><select id="report-project" value={projectId} disabled={!state.projects?.length||!!state.error} onChange={event=>setProjectId(event.target.value)} className="w-full rounded-lg border border-[#354368] bg-[#0e1428] px-3 py-2.5 text-sm text-[#eef1f8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24]">{(state.projects||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button type="button" className={`${button} mt-3`} disabled={!state.projects&&!state.error} onClick={refreshProjects}>{state.error?'Retry projects':'Refresh project list'}</button>{isMockToken(token)?<p role="alert" className="mt-3 text-sm text-red-300">Sign in to view persisted reports for your owned projects.</p>:<>{!state.projects&&!state.error&&<p role="status" className="mt-3 text-sm text-[#b9c2d6]">Loading owned projects...</p>}{state.error&&<p role="alert" className="mt-3 text-sm text-red-300">{state.error}</p>}{state.projects?.length===0&&<p className="mt-3 text-sm text-[#8f99b0]">No owned persisted projects. Upload source to an owned project in Workspace first. Project membership does not grant report access.</p>}</>}</div>{!state.error&&state.projects?.some(p=>p.id===projectId)&&<ProjectReport key={`${token}:${projectId}`} token={token} projectId={projectId}/>}</section>
}
export default function ReportsPage(){const token=useAuthStore(s=>s.token),user=useAuthStore(s=>s.user);return <ReportsSession key={`${user?.id||user?.email||'signed-out'}:${token||''}`} token={token}/>}
