export const REPORT_SEVERITIES=Object.freeze(['Critical','High','Medium','Low','Info'])
const number=n=>Number.isSafeInteger(n)&&n>=0
const text=s=>typeof s==='string'&&s.length>0
const percent=(done,total)=>total?Math.round(done/total*10000)/100:null
const invalid=()=>{throw Error('Invalid persisted report response.')}
export function validateReportProjects(data){
 if(!Array.isArray(data?.projects)||data.projects.some(p=>!text(p?.id)||!/^[a-zA-Z0-9_-]{1,160}$/.test(p.id)||!text(p.name))||new Set(data.projects.map(p=>p.id)).size!==data.projects.length)invalid()
 return data.projects
}
export function validateReport(report,projectId){
 if(typeof projectId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(projectId)||!report||report.project?.id!==projectId||!text(report.project.name)||!text(report.asOf)||!Number.isFinite(Date.parse(report.asOf)))invalid()
 const t=report.tasks
 if(!t||!['total','toDo','inProgress','done'].every(key=>number(t[key]))||t.toDo+t.inProgress+t.done!==t.total||t.completionPercent!==percent(t.done,t.total))invalid()
 if(!Array.isArray(report.sprints)||new Set(report.sprints.map(s=>s?.id)).size!==report.sprints.length||report.sprints.some(s=>!text(s?.id)||!text(s.name)||!text(s.status)||!number(s.total)||!number(s.done)||s.done>s.total||s.completionPercent!==percent(s.done,s.total)))invalid()
 for(const group of [report.reviews?.fileReviews,report.reviews?.batches]){
  if(!group||!number(group.total)||!Array.isArray(group.byStatus)||group.byStatus.some(row=>!text(row?.status)||!number(row.count))||new Set(group.byStatus.map(row=>row.status)).size!==group.byStatus.length||group.byStatus.reduce((n,r)=>n+r.count,0)!==group.total)invalid()
 }
 const f=report.reviews?.findings
 if(!f||!number(f.total)||!Array.isArray(f.bySeverity)||f.bySeverity.some(row=>!row||(row.severity!==null&&typeof row.severity!=='string')||!number(row.count)||row.classification!==(REPORT_SEVERITIES.includes(row.severity)?'current':'historical'))||new Set(f.bySeverity.map(row=>row.severity)).size!==f.bySeverity.length||f.bySeverity.reduce((n,r)=>n+r.count,0)!==f.total)invalid()
 for(const severity of REPORT_SEVERITIES)if(!f.bySeverity.some(row=>row.severity===severity))invalid()
 return report
}
export function severityLabel(row){return `${row.severity===null?'Unspecified':row.severity===''?'Blank severity':row.severity}${row.classification==='historical'?' (historical / other)':''}`}
