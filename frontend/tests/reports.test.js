import test from 'node:test'
import assert from 'node:assert/strict'
import {validateReport,validateReportProjects,REPORT_SEVERITIES,severityLabel} from '../src/data/reports.js'
import {reportCsv} from '../src/services/reportExport.js'
const report=()=>({project:{id:'alpha',name:'Alpha'},asOf:'2026-10-26T10:00:00.000Z',tasks:{total:3,toDo:1,inProgress:1,done:1,completionPercent:33.33},sprints:[{id:'s1',name:'Release',status:'Active',total:2,done:1,completionPercent:50},{id:'s2',name:'Empty',status:'Planning',total:0,done:0,completionPercent:null}],reviews:{fileReviews:{total:2,byStatus:[{status:'Completed',count:2}]},batches:{total:1,byStatus:[{status:'Completed',count:1}]},findings:{total:3,bySeverity:[...REPORT_SEVERITIES.map(severity=>({severity,count:severity==='High'?2:0,classification:'current'})),{severity:'Legacy',count:1,classification:'historical'}]}}})
// Independent RFC-style CSV reader to verify content, quotes, embedded newlines,
// column widths and formula defenses, rather than comparing implementation strings.
function parse(csv){
 const rows=[];let row=[],value='',quoted=false
 for(let i=csv.charCodeAt(0)===0xfeff?1:0;i<csv.length;i++){
  const c=csv[i]
  if(c==='"'){if(quoted&&csv[i+1]==='"'){value+='"';i++}else quoted=!quoted}
  else if(!quoted&&c===','){row.push(value);value=''}
  else if(!quoted&&c==='\r'&&csv[i+1]==='\n'){row.push(value);rows.push(row);row=[];value='';i++}
  else value+=c
 }
 assert.equal(quoted,false);return rows
}
test('report validation enforces project identity, totals, percentages and complete severity groups',()=>{
 assert.deepEqual(validateReportProjects({projects:[{id:'alpha',name:'Alpha'}]}),[{id:'alpha',name:'Alpha'}])
 for(const projects of [[{id:'../bad',name:'Bad'}],[{id:'x'}],[{id:'x',name:'A'},{id:'x',name:'B'}]])assert.throws(()=>validateReportProjects({projects}))
 assert.equal(validateReport(report(),'alpha').tasks.total,3)
 for(const patch of [r=>r.project.id='foreign',r=>r.asOf='bad',r=>r.tasks.done=4,r=>r.tasks.completionPercent=99,r=>r.sprints[1].completionPercent=0,r=>r.reviews.findings.total=99,r=>r.reviews.fileReviews.total=20,r=>r.reviews.findings.bySeverity.pop(),r=>r.reviews.findings.bySeverity[0].classification='historical']){const r=report();patch(r);assert.throws(()=>validateReport(r,'alpha'))}
})
test('CSV contains displayed task, sprint, review and historical severity metrics with the same timestamp',()=>{
 const r=report(),rows=parse(reportCsv(r))
 assert.ok(rows.every(row=>row.length===6))
 assert.deepEqual(rows.find(row=>row[0]==='Project'),['Project','Alpha','ID','alpha','',''])
 assert.equal(rows.find(row=>row[1]==='As of')[3],r.asOf)
 assert.deepEqual(rows.find(row=>row[1]==='All tasks'),['Tasks','All tasks','','3','1','33.33'])
 assert.deepEqual(rows.find(row=>row[1]==='Empty'),['Sprint','Empty','Planning','0','0','No tasks'])
 assert.equal(rows.find(row=>row[1]==='Legacy (historical / other)')[3],'1')
 assert.equal(rows.find(row=>row[0]==='Review batches'&&row[1]==='All statuses')[3],'1')
})
test('CSV round-trips commas, quotes, line breaks and Unicode',()=>{
 const r=report();r.project.name='Résumé, "quoted"\n第二行';r.sprints[0].name='Release\r\nNext, "phase"'
 const rows=parse(reportCsv(r))
 assert.equal(rows.find(row=>row[0]==='Project')[1],r.project.name)
 assert.equal(rows.find(row=>row[0]==='Sprint')[1],r.sprints[0].name)
})
test('CSV neutralizes formulas including whitespace/control-prefixed cells',()=>{
 for(const value of ['=1+1','+SUM(1,2)','-2+3','@SUM(1,2)',' =HYPERLINK("x")','\t=1','\r=1','\n=1','\u0001=1','\uFEFF=1']){
  const r=report();r.project.name=value;r.sprints[0].name=value;r.reviews.fileReviews.byStatus[0].status=value
  const rows=parse(reportCsv(r))
  for(const row of rows.filter(row=>row[1]===`'${value}`))assert.equal(row[1][0],"'")
  assert.equal(rows.find(row=>row[0]==='Project')[1],"'"+value)
  assert.equal(rows.find(row=>row[0]==='Sprint')[1],"'"+value)
  assert.equal(rows.find(row=>row[0]==='File review records'&&row[2]==='Status')[1],"'"+value)
 }
})
test('empty and historical severity values retain visible identities',()=>{
 for(const severity of ['',null,'__proto__','Informational']){
  const r=report();r.reviews.findings.bySeverity.at(-1).severity=severity
  validateReport(r,'alpha')
  const label=severityLabel(r.reviews.findings.bySeverity.at(-1))
  assert.match(label,/historical/);assert.ok(parse(reportCsv(r)).some(row=>row[1]===label))
 }
 const r=report();r.tasks={total:0,toDo:0,inProgress:0,done:0,completionPercent:null}
 assert.equal(parse(reportCsv(r)).find(row=>row[1]==='All tasks')[5],'No tasks')
})
