require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const request=require('supertest')
const {createApp}=require('../src/app')
const {createTestRepository}=require('./helpers/users')
const {signToken}=require('../src/middleware/auth')
const {createSprintRepository}=require('../src/db/sprintRepository')
const v=require('../src/services/sprintValidation')
const body={projectId:'owned',name:'Demonstration',startDate:'2026-10-15',endDate:'2026-10-16'}
function database(){
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),projects=new Map([['owned',owner],['second',owner],['foreign',other]])
 let sprints=[],tasks=[],snapshot,broken=false
 const calls=[],rows=value=>({rows:structuredClone(value)})
 const pool={async connect(){return {query:pool.query,release(){}}},async query(sql,args=[]){
  calls.push({sql,args})
  if(sql.startsWith('BEGIN')){snapshot=structuredClone({sprints,tasks});return rows([])}
  if(sql==='ROLLBACK'){({sprints,tasks}=snapshot);return rows([])}
  if(sql==='COMMIT'){if(broken)throw new Error('private database password');return rows([])}
  if(sql.startsWith('SET LOCAL')||sql.startsWith('SAVEPOINT ')||sql.startsWith('RELEASE SAVEPOINT ')||sql.startsWith('ROLLBACK TO SAVEPOINT ')||sql.startsWith('SELECT set_config'))return rows([])
   if(sql.startsWith('SELECT current_setting'))return rows([{context:''}])
  if(sql.startsWith('SELECT id FROM source_projects'))return rows(projects.get(args[0])===args[1]?[{id:args[0]}]:[])
  if(sql.startsWith('INSERT INTO project_sprints')){
   const [id,projectId,creatorId,name,goal,startDate,endDate,status]=args
   sprints.push({id,projectId,creatorId,name,goal,startDate,endDate,status,createdAt:'2026-10-15',updatedAt:'2026-10-15'});return rows([])
  }
  if(sql.startsWith('SELECT project_id'))return rows(sprints.filter(s=>s.id===args[0]).map(s=>({projectId:s.projectId})))
  if(sql.startsWith('SELECT count(*) AS total FROM project_sprints'))return rows([{total:sprints.filter(s=>s.projectId===args[0]).length}])
  if(sql.startsWith('SELECT id FROM project_sprints'))return rows(sprints.filter(s=>s.projectId===args[0]).sort((a,b)=>b.id.localeCompare(a.id)).slice(args[2],args[2]+args[1]).map(s=>({id:s.id})))
  if(sql.includes('FROM project_sprints s WHERE')){
   const s=sprints.find(s=>s.id===args[0]),assigned=tasks.filter(t=>t.sprintId===s.id && t.projectId===s.projectId)
   return rows([{...s,total:assigned.length,toDo:assigned.filter(t=>t.status==='To Do').length,inProgress:assigned.filter(t=>t.status==='In Progress').length,done:assigned.filter(t=>t.status==='Done').length}])
  }
  if(sql.startsWith('SELECT') && sql.includes('FROM project_sprints WHERE id'))return rows(sprints.filter(s=>s.id===args[0]))
  if(sql.startsWith('UPDATE project_sprints')){
   const s=sprints.find(s=>s.id===args[0]);for(const [i,key] of ['name','goal','startDate','endDate','status'].entries())if(args[i+1]!==null)s[key]=args[i+1];return rows([])
  }
  if(sql.startsWith('SELECT id,sprint_id'))return rows(tasks.filter(t=>t.id===args[0] && t.projectId===args[1]))
  if(sql.startsWith('UPDATE project_tasks')){tasks.find(t=>t.id===args[0]).sprintId=args[1];return rows([])}
  if(sql.startsWith('SELECT') && sql.includes('FROM project_tasks WHERE sprint_id'))return rows(tasks.filter(t=>t.sprintId===args[0] && t.projectId===args[1]).slice(args[3],args[3]+args[2]))
  throw new Error('Unhandled sprint fixture SQL')
 }}
 return {owner,other,projects,pool,calls,repo:createSprintRepository(pool),breakCommit(){broken=true},task(projectId='owned',status='To Do'){const t={id:crypto.randomUUID(),projectId,status,sprintId:null,assigneeUserId:null,assignee:null};tasks.push(t);return t}}
}
async function fixture(){
 const f=database(),users=createTestRepository(),owner={id:f.owner,email:'owner@sprints.test',role:'Developer'}
 await users.createUser(owner)
 const tokens=[]
 for(const role of ['Developer','Team Lead','Project Manager']){const u={id:crypto.randomUUID(),email:role.replaceAll(' ','')+'@sprints.test',role};await users.createUser(u);tokens.push(signToken(u))}
 return {...f,users,tokens,token:signToken(owner),app:createApp({userRepository:users,sprintRepository:f.repo})}
}
function call(f,method,path='',payload,token=f.token){const r=request(f.app)[method]('/api/project-sprints'+path).set('Authorization','Bearer '+token);return payload===undefined?r:r.send(payload)}
test('durable sprint create/read/list/update, empty state and status do not fabricate progress',async()=>{
 const f=await fixture(),created=await call(f,'post','',body)
 assert.equal(created.status,201);const s=created.body.sprint
 assert.equal(s.creatorId,f.owner);assert.equal(s.status,'Planning');assert.equal(s.progress,null);assert.equal(s.empty,true);assert.deepEqual(s.counts,{toDo:0,inProgress:0,done:0,total:0})
 for(const status of v.STATUSES){const r=await call(f,'patch','/'+s.id,{status});assert.equal(r.status,200);assert.equal(r.body.sprint.status,status);assert.equal(r.body.sprint.progress,null)}
 const restarted=createSprintRepository(f.pool);assert.equal((await restarted.read(s.id,f.owner)).status,'Completed')
 assert.equal((await call(f,'get','?projectId=owned')).body.total,1)
 assert.equal((await call(f,'get','/'+s.id)).body.sprint.name,body.name)
})
test('assignment is idempotent, same-project only, one sprint per task, and removable',async()=>{
 const f=await fixture(),s=await f.repo.create(body,f.owner),second=await f.repo.create(body,f.owner),t=f.task(),cross=f.task('second')
 const path=`/${s.id}/tasks/${t.id}`
 assert.equal((await call(f,'put',path)).status,200);assert.equal((await call(f,'put',path)).body.sprint.counts.total,1)
 assert.equal((await call(f,'put',`/${second.id}/tasks/${t.id}`)).status,409)
 assert.equal((await call(f,'put',`/${s.id}/tasks/${cross.id}`)).status,404)
 assert.equal((await call(f,'put',`/${s.id}/tasks/${crypto.randomUUID()}`)).status,404)
 const listed=await call(f,'get',`/${s.id}/tasks?limit=1&offset=0`);assert.equal(listed.body.tasks[0].id,t.id);assert.equal(listed.body.tasks[0].sprintId,s.id);assert.equal(listed.body.tasks[0].assigneeUserId,null);assert.equal(listed.body.tasks[0].assignee,null);assert.equal(listed.body.total,1)
 assert.equal((await call(f,'delete',path)).body.sprint.progress,null)
 assert.equal((await call(f,'delete',path)).status,404)
 assert.equal((await call(f,'put',`/${second.id}/tasks/${t.id}`)).status,200)
})
test('progress uses all assigned task statuses and changes after real task state changes',async()=>{
 const f=database(),s=await f.repo.create(body,f.owner),tasks=[f.task(),f.task('owned','In Progress'),f.task('owned','Done')]
 for(const t of tasks)await f.repo.assign(s.id,t.id,f.owner)
 let result=await f.repo.read(s.id,f.owner)
 assert.deepEqual(result.counts,{toDo:1,inProgress:1,done:1,total:3});assert.equal(result.progress,33.33)
 tasks[0].status='Done';result=await f.repo.update(s.id,f.owner,{status:'Completed'})
 assert.equal(result.progress,66.67);assert.equal(tasks[1].status,'In Progress');assert.equal(result.counts.done,2)
 assert.equal((await f.repo.tasks(s.id,f.owner,{limit:'1',offset:'1'})).total,3)
})
test('sprint summaries include all pages and exclude removed, unassigned and other-project tasks',async()=>{
 const f=database(),s=await f.repo.create(body,f.owner)
 const tasks=Array.from({length:25},()=>f.task())
 for(const task of tasks)await f.repo.assign(s.id,task.id,f.owner)
 f.task('owned','Done');f.task('second','Done')
 for(const [status,counts] of [['To Do',{toDo:25,inProgress:0,done:0,total:25}],['In Progress',{toDo:24,inProgress:1,done:0,total:25}],['Done',{toDo:24,inProgress:0,done:1,total:25}]]){
  tasks[24].status=status
  const restarted=createSprintRepository(f.pool)
  assert.deepEqual((await restarted.list(f.owner,{projectId:'owned'})).sprints[0].counts,counts)
  assert.equal((await restarted.tasks(s.id,f.owner,{limit:'20',offset:'20'})).tasks.length,5)
 }
 await f.repo.assign(s.id,tasks[24].id,f.owner,true)
 const saved=await createSprintRepository(f.pool).read(s.id,f.owner)
 assert.deepEqual(saved.counts,{toDo:24,inProgress:0,done:0,total:24})
 assert.equal(tasks[24].status,'Done');assert.equal(tasks[24].sprintId,null)
})

test('authentication, current ownership and manager/lead isolation apply to every endpoint',async()=>{
 const f=await fixture(),s=await f.repo.create(body,f.owner),t=f.task()
 const operations=[['post','',body],['get','?projectId=owned'],['get','/'+s.id],['patch','/'+s.id,{status:'Active'}],['get',`/${s.id}/tasks`],['put',`/${s.id}/tasks/${t.id}`],['delete',`/${s.id}/tasks/${t.id}`]]
 for(const [method,path,payload] of operations){assert.equal((await call(f,method,path,payload,'invalid')).status,401);for(const token of f.tokens)assert.equal((await call(f,method,path,payload,token)).status,404)}
 f.projects.set('owned',f.other)
 await assert.rejects(f.repo.read(s.id,f.owner),e=>e.code==='not_found')
 assert.equal((await f.repo.read(s.id,f.other)).creatorId,f.owner)
})
test('strict request/date/ID validation and merged date validation reject invalid requests',async()=>{
 const f=await fixture(),s=await f.repo.create(body,f.owner)
 for(const input of [{...body,name:''},{...body,name:'x'.repeat(161)},{...body,goal:'x'.repeat(1001)},{...body,startDate:'2026-02-30'},{...body,startDate:'2026-10-17'},{...body,endDate:null},{...body,status:'Done'},{...body,progress:100},{...body,projectId:'../bad'},[]])assert.equal((await call(f,'post','',input)).status,400)
 for(const input of [{},{projectId:'second'},{creatorId:f.owner},{startDate:'2026-10-17'},{endDate:'2026-10-14'},{status:null}])assert.equal((await call(f,'patch','/'+s.id,input)).status,400)
 assert.equal((await call(f,'get','/invalid')).status,400)
 assert.equal((await call(f,'get','/'+crypto.randomUUID())).status,404)
 for(const query of ['', '?projectId=owned&limit=0','?projectId=owned&limit=51','?projectId=owned&offset=-1','?projectId=owned&extra=x'])assert.equal((await call(f,'get',query)).status,400)
 assert.equal((await call(f,'get',`/${s.id}/tasks?projectId=second`)).status,400)
 assert.equal((await call(f,'put',`/${s.id}/tasks/${f.task().id}`,{projectId:'second'})).status,400)
})
test('pagination is bounded and project scoped; transaction failure rolls back without secrets',async()=>{
 const f=await fixture()
 for(let i=0;i<3;i++)await f.repo.create(body,f.owner)
 await f.repo.create({...body,projectId:'second'},f.owner)
 const a=(await call(f,'get','?projectId=owned&limit=2')).body,b=(await call(f,'get','?projectId=owned&limit=2&offset=2')).body
 assert.equal(a.total,3);assert.equal(a.sprints.length,2);assert.equal(b.sprints.length,1);assert.ok(!a.sprints.some(s=>s.id===b.sprints[0].id))
 f.breakCommit();const r=await call(f,'post','',body);assert.equal(r.status,503);assert.equal(r.body.code,'sprint_storage_unavailable');assert.doesNotMatch(JSON.stringify(r.body),/private|password/)
 assert.ok(f.calls.some(c=>c.sql==='ROLLBACK'))
 const count=await f.pool.query('SELECT count(*) AS total FROM project_sprints WHERE project_id=$1',['owned']);assert.equal(count.rows[0].total,3)
})
