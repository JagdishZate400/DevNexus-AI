require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const request=require('supertest')
const {createApp}=require('../src/app')
const {createTestRepository}=require('./helpers/users')
const {signToken}=require('../src/middleware/auth')
const {createTaskRepository}=require('../src/db/taskRepository')
const v=require('../src/services/taskValidation')
function database(){
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),members=new Map(),projects=new Map([['owned',owner],['foreign',other],['second',owner]])
 let tasks=[],snapshot,failCommit=false
 const calls=[],pool={
  async connect(){return {query:pool.query,release(){}}},
  async query(sql,args=[]){
   calls.push({sql,args});const rows=data=>({rows:structuredClone(data)})
   if(sql.startsWith('BEGIN')){snapshot=structuredClone(tasks);return rows([])}
   if(sql==='ROLLBACK'){tasks=snapshot;return rows([])}
   if(sql==='COMMIT'){if(failCommit)throw new Error('private SQL credentials');return rows([])}
   if(sql.startsWith('SET LOCAL')||sql.startsWith('SAVEPOINT ')||sql.startsWith('RELEASE SAVEPOINT ')||sql.startsWith('ROLLBACK TO SAVEPOINT ')||sql.startsWith('SELECT set_config'))return rows([])
   if(sql.startsWith('SELECT current_setting'))return rows([{context:''}])
   if(sql.startsWith('SELECT id FROM source_projects'))return rows(projects.get(args[0])===args[1] ? [{id:args[0]}]:[])
   if(sql.startsWith('SELECT project_id AS "projectId" FROM project_tasks'))return rows(tasks.filter(t=>t.id===args[0]).map(t=>({projectId:t.projectId})))
   if(sql.startsWith('SELECT id FROM project_tasks WHERE'))return rows(tasks.filter(t=>t.id===args[0] && t.projectId===args[1]))
   if(sql.startsWith('SELECT id FROM project_memberships'))return rows(members.get(args[1])===args[0]?[{id:args[1]}]:[])
   if(sql.startsWith('SELECT id FROM users'))return rows(args[0]===owner||members.has(args[0])?[{id:args[0]}]:[])
   if(sql.startsWith('INSERT INTO project_tasks')){
    const [id,projectId,creatorId,title,description,status,priority,assigneeUserId]=args
    const task={id,projectId,creatorId,title,description,status,priority,assigneeUserId,assignee:assigneeUserId?{userId:assigneeUserId,displayName:"Registered",email:"registered@test"}:null,sprintId:null,createdAt:new Date(1700000000000+tasks.length).toISOString(),updatedAt:new Date().toISOString()};tasks.push(task);return rows([task])
   }
   if(sql.startsWith('SELECT count'))return rows([{total:tasks.filter(task=>task.projectId===args[0]).length}])
   if(sql.startsWith('SELECT') && sql.includes('FROM project_tasks')){
    const selected=tasks.filter(task=>projects.get(task.projectId)===args[1] && (sql.includes('WHERE t.id=$1') ? task.id===args[0] : task.projectId===args[0]))
    return rows(sql.includes('LIMIT') ? selected.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(args[3],args[3]+args[2]) : selected)
   }
   if(sql.startsWith('UPDATE project_tasks')){const task=tasks.find(task=>task.id===args[0]);for(const [index,key] of ['title','description','status','priority'].entries())if(args[index+1]!==null)task[key]=args[index+1];if(args[5]){task.assigneeUserId=args[6];task.assignee=args[6]?{userId:args[6],displayName:'Registered',email:'registered@test'}:null}task.updatedAt=new Date().toISOString();return rows([task])}
   if(sql.startsWith('DELETE FROM project_tasks')){tasks=tasks.filter(task=>task.id!==args[0]);return rows([])}
   throw new Error('Unhandled SQL in fixture')
  },
 }
 return {pool,owner,other,members,projects,calls,repo:createTaskRepository(pool),breakCommit(){failCommit=true}}
}
async function fixture(){
 const db=database(),users=createTestRepository(),owner={id:db.owner,email:'owner@tasks.test',role:'Developer'}
 await users.createUser(owner)
 const tokens=[]
 for(const [index,role] of ['Developer','Team Lead','Project Manager'].entries()){
  const user={id:crypto.randomUUID(),email:`other${index}@tasks.test`,role};await users.createUser(user);tokens.push(signToken(user))
 }
 return {...db,users,token:signToken(owner),tokens,app:createApp({userRepository:users,taskRepository:db.repo})}
}
const body={projectId:'owned',title:'Implement project tasks'}
function call(f,method,path='',payload,token=f.token){let req=request(f.app)[method](`/api/project-tasks${path}`).set('Authorization',`Bearer ${token}`);return payload===undefined ? req : req.send(payload)}

test('B2 HTTP assignment create, preserve, reassign, clear and atomic rejection',async()=>{
 const f=await fixture(),member=crypto.randomUUID();f.members.set(member,'owned')
 const created=await call(f,'post','',{...body,assigneeUserId:member})
 assert.equal(created.status,201);const task=created.body.task
 assert.equal(task.assigneeUserId,member);assert.equal(task.assignee.userId,member);assert.equal(task.sprintId,null)
 assert.equal((await call(f,'patch','/'+task.id,{status:'Done'})).body.task.assigneeUserId,member)
 assert.equal((await call(f,'patch','/'+task.id,{assigneeUserId:f.owner})).body.task.assigneeUserId,f.owner)
 assert.equal((await call(f,'patch','/'+task.id,{assigneeUserId:null})).body.task.assignee,null)
 const errors=[]
 for(const id of [crypto.randomUUID(),f.other]){
  const result=await call(f,'patch','/'+task.id,{assigneeUserId:id,title:'Must roll back'})
  assert.equal(result.status,400);errors.push({code:result.body.code,message:result.body.message})
 }
 assert.deepEqual(errors[0],errors[1]);assert.equal(errors[0].code,'assignee_not_eligible')
 assert.equal((await f.repo.read(task.id,f.owner)).title,body.title)
 for(const token of f.tokens)assert.equal((await call(f,'patch','/'+task.id,{assigneeUserId:f.owner},token)).status,404)
 const begin=f.calls.findLastIndex(c=>c.sql.startsWith('BEGIN'))
 assert.ok(f.calls.slice(begin).some(c=>c.sql==='ROLLBACK'))
})
test('project task CRUD and status changes use actual repository SQL and survive repository/app recreation',async()=>{
 const f=await fixture(),created=await call(f,'post','',body)
 assert.equal(created.status,201);const task=created.body.task;assert.match(task.id,/^[a-f0-9-]{36}$/);assert.equal(task.creatorId,f.owner);assert.equal(task.status,'To Do');assert.equal(task.priority,'Medium');assert.equal(task.description,'');assert.equal(task.assigneeUserId,null);assert.equal(task.assignee,null);assert.equal(task.sprintId,null)
 for(const status of v.STATUSES){const updated=await call(f,'patch',`/${task.id}`,{title:'Edited title',description:'Actual description',status,priority:'High'});assert.equal(updated.status,200);assert.equal(updated.body.task.status,status);assert.equal(updated.body.task.assigneeUserId,null);assert.equal(updated.body.task.assignee,null);assert.equal(updated.body.task.sprintId,null)}
 const restarted=createApp({userRepository:f.users,taskRepository:createTaskRepository(f.pool)})
 const read=await request(restarted).get(`/api/project-tasks/${task.id}`).set('Authorization',`Bearer ${f.token}`)
 assert.equal(read.body.task.title,'Edited title');assert.equal(read.body.task.status,'Done')
 assert.equal((await call(f,'get','?projectId=owned')).body.total,1)
 assert.equal((await call(f,'delete',`/${task.id}`)).status,204);assert.equal((await call(f,'get',`/${task.id}`)).status,404)
})
test('every task endpoint requires JWT authentication',async()=>{
 const f=await fixture(),id=crypto.randomUUID()
 for(const [method,path,payload] of [['post','',body],['get','?projectId=owned'],['get',`/${id}`],['patch',`/${id}`,{status:'Done'}],['delete',`/${id}`]])assert.equal((await call(f,method,path,payload,'invalid')).status,401)
})
test('cross-user manager/lead and matching assignee claims cannot bypass ownership',async()=>{
 const f=await fixture(),task=await f.repo.create(body,f.owner)
 for(const token of f.tokens)for(const [method,path,payload] of [['post','',body],['get','?projectId=owned'],['get',`/${task.id}`],['patch',`/${task.id}`,{status:'Done'}],['delete',`/${task.id}`]])assert.equal((await call(f,method,path,payload,token)).status,404)
 assert.equal((await call(f,'post','',{...body,assignee:'owner@tasks.test'})).status,400)
 assert.equal((await call(f,'post','',{...body,projectId:'foreign'})).status,404)
 assert.equal((await call(f,'get','?projectId=foreign')).status,404)
 assert.equal((await f.repo.read(task.id,f.owner)).status,'To Do')
})
test('current project ownership, not original task creator, determines access after transfer',async()=>{
 const f=database(),task=await f.repo.create(body,f.owner)
 f.projects.set('owned',f.other)
 assert.equal(await f.repo.read(task.id,f.owner),null)
 await assert.rejects(f.repo.update(task.id,f.owner,{status:'Done'}),e=>e.code==='not_found')
 assert.equal((await f.repo.update(task.id,f.other,{status:'Done'})).creatorId,f.owner)
 assert.equal((await f.repo.read(task.id,f.other)).status,'Done')
})
test('pagination is bounded, stable and project scoped, including empty owned project',async()=>{
 const f=await fixture()
 for(let i=0;i<3;i++)await f.repo.create({...body,title:`Task ${i}`},f.owner)
 await f.repo.create({...body,projectId:'second',title:'Separate task'},f.owner)
 const first=await call(f,'get','?projectId=owned&limit=2&offset=0'),second=await call(f,'get','?projectId=owned&limit=2&offset=2')
 assert.equal(first.body.total,3);assert.equal(first.body.limit,2);assert.equal(first.body.tasks.length,2);assert.equal(second.body.tasks.length,1)
 assert.ok(!first.body.tasks.some(task=>task.id===second.body.tasks[0].id));assert.ok(first.body.tasks.every(task=>task.projectId==='owned'))
 assert.equal((await call(f,'get','?projectId=owned&offset=999')).body.tasks.length,0)
 const empty=await fixture();assert.deepEqual((await call(empty,'get','?projectId=owned')).body,{tasks:[],total:0,limit:20,offset:0})
 assert.ok(f.calls.some(call=>call.sql==='BEGIN ISOLATION LEVEL REPEATABLE READ'))
})
test('invalid payloads, immutable fields, IDs, statuses and pagination rejected',async()=>{
 const f=await fixture(),task=await f.repo.create(body,f.owner)
 for(const payload of [{...body,title:''},{...body,title:10},{...body,title:'x'.repeat(201)},{...body,description:'x'.repeat(2001)},{...body,description:null},{...body,title:'bad\u0000title'},{...body,status:'Todo'},{...body,status:'Completed'},{...body,priority:'Urgent'},{...body,creatorId:f.owner},{...body,assigneeUserId:'bad'},{...body,assignee:null},{...body,projectId:'../foreign'},[]])assert.equal((await call(f,'post','',payload)).status,400)
 for(const payload of [{},{projectId:'foreign'},{id:task.id},{createdAt:'now'},{assigneeEmail:'owner@tasks.test'},{assigneeUserId:'bad'},{assignee:null},{title:null},{status:null}])assert.equal((await call(f,'patch',`/${task.id}`,payload)).status,400)
 for(const query of ['', '?projectId=owned&limit=0','?projectId=owned&limit=51','?projectId=owned&offset=-1','?projectId=owned&limit=2.5','?projectId=owned&limit=1&limit=2','?projectId=owned&status=Done'])assert.equal((await call(f,'get',query)).status,400)
 for(const method of ['get','patch','delete'])assert.equal((await call(f,method,'/bad-id',method==='patch'?{status:'Done'}:undefined)).status,400)
 assert.equal((await call(f,'get',`/${crypto.randomUUID()}`)).status,404)
})
test('SQL transaction rollback preserves tasks and API storage errors are sanitized without fallback',async()=>{
 const f=await fixture();f.breakCommit()
 const result=await call(f,'post','',body)
 assert.equal(result.status,503);assert.equal(result.body.code,'task_storage_unavailable');assert.doesNotMatch(JSON.stringify(result.body),/private|credentials/)
 assert.ok(f.calls.some(call=>call.sql==='ROLLBACK'))
 assert.equal((await f.pool.query('SELECT count(*) AS total FROM project_tasks WHERE project_id=$1',['owned'])).rows[0].total,0)
})
