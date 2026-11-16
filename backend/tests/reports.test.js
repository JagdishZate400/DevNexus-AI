require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const request=require('supertest')
const {createApp}=require('../src/app')
const {createTestRepository}=require('./helpers/users')
const {signToken}=require('../src/middleware/auth')
const {reportsFixture}=require('./helpers/reports')
async function fixture(){
 const ids={owner:crypto.randomUUID(),member:crypto.randomUUID(),other:crypto.randomUUID()}
 const f=reportsFixture(ids.owner,ids.other),users=createTestRepository(),tokens={}
 // Membership in alpha exists; even a global management role cannot bypass ownership.
 f.state.members.push({projectId:'alpha',userId:ids.member})
 for(const [name,id] of Object.entries(ids)){
  const user={id,fullName:name,email:`${name}@reports.test`,role:name==='member'?'Team Lead':'Developer',tokenVersion:0}
  await users.createUser(user);tokens[name]=signToken(user)
 }
 const app=createApp({userRepository:users,reportsRepository:f.repo})
 const get=(path,who='owner')=>request(app).get(path).set('Authorization','Bearer '+tokens[who])
 return {...f,app,get,ids,tokens}
}
test('reports discovery and report reads require current project ownership, never membership or global role',async()=>{
 const f=await fixture()
 assert.deepEqual((await f.get('/api/reports/projects')).body.projects.map(p=>p.id),['alpha','empty'])
 assert.deepEqual((await f.get('/api/reports/projects','member')).body.projects,[])
 assert.deepEqual((await f.get('/api/reports/projects','other')).body.projects.map(p=>p.id),['foreign'])
 for(const who of ['member','other'])assert.equal((await f.get('/api/reports/project?projectId=alpha',who)).status,404)
 assert.equal((await f.get('/api/reports/project?projectId=foreign')).status,404)
 assert.equal((await f.get('/api/reports/project?projectId=unknown')).status,404)
 assert.equal((await request(f.app).get('/api/reports/projects')).status,401)
 assert.equal((await request(f.app).get('/api/reports/project?projectId=alpha')).status,401)
 f.state.projects[0].ownerId=f.ids.other
 assert.equal((await f.get('/api/reports/project?projectId=alpha')).status,404)
 assert.equal((await f.get('/api/reports/project?projectId=alpha','other')).status,200)
})
test('report aggregates all tasks beyond API page limits and preserves project/sprint isolation',async()=>{
 const f=await fixture(),res=await f.get('/api/reports/project?projectId=alpha')
 assert.equal(res.status,200);assert.equal(res.headers['cache-control'],'no-store')
 assert.equal(res.body.project.id,'alpha');assert.equal(res.body.asOf,f.asOf)
 assert.deepEqual(res.body.tasks,{total:150,toDo:50,inProgress:30,done:70,completionPercent:46.67})
 assert.deepEqual(res.body.sprints[0],{id:'sprint-one',name:'Delivery',status:'Active',total:90,done:70,completionPercent:77.78})
 assert.equal(res.body.sprints[1].completionPercent,null)
 assert.equal(res.body.sprints[1].total,0)
 const sql=f.state.calls.map(c=>c.sql)
 assert.ok(sql.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'))
 assert.match(sql.find(s=>s.startsWith('SELECT s.id')),/t.project_id=s.project_id/)
 assert.ok(sql.every(s=>!/^INSERT|^UPDATE|^DELETE|^CREATE|^ALTER/.test(s)))
 assert.equal(sql.at(-1),'COMMIT');assert.equal(f.state.released,1)
})
test('file records and batches are separate; finding occurrences do not multiply across batch links',async()=>{
 const f=await fixture(),r=(await f.get('/api/reports/project?projectId=alpha')).body.reviews
 assert.equal(r.fileReviews.total,5);assert.equal(r.batches.total,2);assert.equal(r.findings.total,4)
 assert.equal(r.fileReviews.byStatus.find(s=>s.status==='Completed').count,3)
 assert.equal(r.findings.bySeverity.find(s=>s.severity==='High').count,2)
 assert.deepEqual(r.findings.bySeverity.find(s=>s.severity==='Legacy'),{severity:'Legacy',count:1,classification:'historical'})
 assert.equal(r.findings.bySeverity.find(s=>s.severity==='Critical').count,0)
 assert.ok(f.state.calls.every(c=>!c.sql.includes('repository_review_batch_files')))
 const findingSql=f.state.calls.find(c=>c.sql.startsWith('SELECT f.severity')).sql
 assert.match(findingSql,/r.status='Completed'/);assert.doesNotMatch(findingSql,/LIMIT|batch/)
})
test('historical severity strings, null and prototype-like labels are retained',async()=>{
 const f=await fixture()
 for(const severity of ['Unknown','__proto__','',null])f.state.findings.push({reviewId:'r0',severity})
 const res=await f.get('/api/reports/project?projectId=alpha')
 assert.equal(res.status,200);assert.equal(res.body.reviews.findings.total,8)
 for(const severity of ['Unknown','__proto__','',null])assert.deepEqual(res.body.reviews.findings.bySeverity.find(row=>row.severity===severity),{severity,count:1,classification:'historical'})
})
test('empty project has real zeros, null completion, no sprints and no saved reviews',async()=>{
 const f=await fixture(),res=await f.get('/api/reports/project?projectId=empty')
 assert.equal(res.status,200);assert.deepEqual(res.body.tasks,{total:0,toDo:0,inProgress:0,done:0,completionPercent:null})
 assert.deepEqual(res.body.sprints,[]);assert.equal(res.body.reviews.fileReviews.total,0);assert.equal(res.body.reviews.findings.total,0)
})
test('report input validation rejects missing, extra, duplicate and noncanonical project inputs',async()=>{
 const f=await fixture()
 for(const path of ['/api/reports/project','/api/reports/project?projectId=../bad','/api/reports/project?projectId=alpha&ownerId=other','/api/reports/project?projectId=alpha&projectId=empty','/api/reports/projects?includeMembers=true'])assert.equal((await f.get(path)).status,400,path)
})
test('missing required storage fails closed, sanitizes details and rolls back snapshots',async()=>{
 for(const table of ['source_projects','project_tasks','project_sprints','repository_reviews','repository_review_batches','repository_review_findings']){
  const f=await fixture();f.state.missing=table
  const res=await f.get('/api/reports/project?projectId=alpha')
  assert.equal(res.status,503,table);assert.equal(res.body.code,'reports_unavailable');assert.doesNotMatch(JSON.stringify(res.body),/private SQL/)
  assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');assert.equal(f.state.released,1)
 }
 const f=await fixture();f.state.missing='source_projects'
 assert.equal((await f.get('/api/reports/projects')).status,503)
})
test('legacy report list/generate/archive are retired without exposing or mutating snapshots',async()=>{
 const f=await fixture(),{reports}=require('../src/db/memory')
 const before=JSON.stringify(reports),calls=f.state.calls.length
 for(const [method,path] of [['get','/api/reports'],['post','/api/reports/generate'],['patch','/api/reports/old-snapshot']]){
  for(const who of ['owner','member','other']){
   const res=await request(f.app)[method](path).set('Authorization','Bearer '+f.tokens[who]).send({status:'Archived'})
   assert.equal(res.status,410);assert.equal(res.body.code,'reports_retired');assert.equal(res.body.report,undefined)
  }
  assert.equal((await request(f.app)[method](path)).status,401)
 }
 assert.equal(JSON.stringify(reports),before);assert.equal(f.state.calls.length,calls)
})
test('Dashboard summary preserves its contract while scoping all report counts to persisted ownership',async()=>{
 const f=await fixture(),res=await f.get('/api/reports/summary')
 assert.equal(res.status,200);assert.equal(res.headers['cache-control'],'no-store')
 assert.deepEqual(Object.keys(res.body).sort(),['generatedAt','projects','tasks','sprints','team','reviews','documents','security'].sort())
 assert.equal(res.body.projects.total,2);assert.equal(res.body.tasks.total,150)
 assert.equal(res.body.reviews.total,3);assert.equal(res.body.reviews.savedTotal,5)
 assert.equal(res.body.documents.total,1);assert.equal(res.body.security.total,2)
 assert.equal(res.body.team.total,2);assert.equal(res.body.tasks.byStatus.Done,70)
 assert.deepEqual(res.body.documents.byType,{'project-overview':1})
 const member=(await f.get('/api/reports/summary','member')).body
 for(const key of ['projects','tasks','sprints','team','reviews','documents','security'])assert.equal(member[key].total,0,key)
 assert.equal((await request(f.app).get('/api/reports/summary')).status,401)
 f.state.missing='project_documents'
 const unavailable=await f.get('/api/reports/summary')
 assert.equal(unavailable.status,503);assert.equal(unavailable.body.code,'reports_unavailable')
})
test('OpenAPI describes current report endpoints and retires every snapshot action',async()=>{
 const f=await fixture(),res=await f.get('/api/openapi.json')
 assert.ok(res.body.paths['/reports/project'].get.parameters.some(p=>p.name==='projectId'&&p.required))
 for(const [path,method] of [['/reports','get'],['/reports/generate','post'],['/reports/{id}','patch']]){
  assert.equal(res.body.paths[path][method].deprecated,true)
  assert.ok(res.body.paths[path][method].responses['410'])
 }
})
