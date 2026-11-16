import {validateReport,severityLabel} from '../data/reports.js'
function cell(value){
 let text=value===null?'No tasks':String(value)
 // Quoting alone does not prevent spreadsheet evaluation. Also protect formulas
 // hidden behind whitespace/control characters, including an initial tab/newline.
 // eslint-disable-next-line no-control-regex -- Intentional spreadsheet-injection defense.
 if(/^[\s\x00-\x1f]*[=+@-]/u.test(text)||/^[\t\r\n]/u.test(text))text="'"+text
 return `"${text.replaceAll('"','""')}"`
}
export function reportCsv(report){
 validateReport(report,report?.project?.id)
 const rows=[['Section','Name','Status / Category','Total / Value','Completed','Completion (%)'],
  ['Project',report.project.name,'ID',report.project.id,'',''],['Report','As of','UTC',report.asOf,'',''],
  ['Tasks','All tasks','',report.tasks.total,report.tasks.done,report.tasks.completionPercent],
  ...[['To Do','toDo'],['In Progress','inProgress'],['Done','done']].map(([name,key])=>['Tasks',name,'Status',report.tasks[key],'','']),
  ...report.sprints.map(s=>['Sprint',s.name,s.status,s.total,s.done,s.completionPercent]),
  ['File review records','All statuses','Includes batch child records',report.reviews.fileReviews.total,'',''],
  ...report.reviews.fileReviews.byStatus.map(r=>['File review records',r.status,'Status',r.count,'','']),
  ['Review batches','All statuses','Separate from file records',report.reviews.batches.total,'',''],
  ...report.reviews.batches.byStatus.map(r=>['Review batches',r.status,'Status',r.count,'','']),
  ['Finding occurrences','All severities','Completed file review records',report.reviews.findings.total,'',''],
  ...report.reviews.findings.bySeverity.map(r=>['Finding occurrences',severityLabel(r),'Severity',r.count,'','']),
  ['Definition','Repeated findings in different review records count as separate occurrences.','','','','']]
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n'
}
export function downloadReportCsv(report){
 const blob=new Blob([reportCsv(report)],{type:'text/csv;charset=utf-8'})
 const url=URL.createObjectURL(blob),link=document.createElement('a')
 link.href=url;link.download=`project-report-${report.project.id}.csv`;document.body.appendChild(link);link.click();link.remove()
 setTimeout(()=>URL.revokeObjectURL(url),1000)
}
