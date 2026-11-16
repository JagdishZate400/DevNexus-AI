require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const request=require('supertest')
const {createApp}=require('../src/app')
const {createTestRepository}=require('./helpers/users')
const {signToken}=require('../src/middleware/auth')
const {createMembershipRepository}=require('../src/db/membershipRepository')
const {createTaskRepository}=require('../src/db/taskRepository')

// Offline SQL-contract fixture: never imports postgres, configures a URL or runs SQL.
async function fixture(){
 const ids=Object.fromEntries(['owner','member','stranger'].map(k=>[k,crypto.randomUUID()]))
 const projects=[{id:'alpha',name:'Alpha',ownerId:ids.owner},{id:'beta',name:'Beta',ownerId:ids.stranger}]
 const member={id:crypto.randomUUID(),projectId:'alpha',userId:ids.member,displayName:'Member',email:'member@test.example',displayRole:'Viewer'}
 const task={id:crypto.randomUUID(),projectId:'alpha',title:'Saved task',description:'Evidence',status:'To Do',priority:'Medium',assigneeUserId:ids.member}
 const state={members:[member],calls:[],broken:false}
 const rows=rows=>({rows:structuredClone(rows)})
 const pool={async connect(){return {query:pool.query,release(){}}},async query(sql,args=[]){
  state.calls.push({sql,args});if(state.broken)throw Error('private storage details')
  if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql))return rows([])
  if(sql.includes('CASE WHEN p.owner_id=$1'))return rows(projects.filter(p=>p.ownerId===args[0]||state.members.some(m=>m.projectId===p.id&&m.userId===args[0])).map(p=>({...p,access:p.ownerId===args[0]?'owner':'member'})))
  if(sql.startsWith('SELECT id,owner_id'))return rows(projects.filter(p=>p.id===args[0]).map(p=>({id:p.id,ownerId:p.ownerId})))
  if(sql.startsWith('SELECT id FROM source_projects'))return rows(projects.filter(p=>p.id===args[0]&&p.ownerId===args[1]))
  if(sql.startsWith('SELECT id FROM project_memberships'))return rows(state.members.filter(m=>m.projectId===args[0]&&m.userId===args[1]))
  if(sql.startsWith('SELECT id AS "userId"'))return rows([{userId:args[0],displayName:'Registered Owner',email:'owner@test.example'}])
  if(sql.startsWith('SELECT project_id AS'))return rows(args[0]===task.id?[{projectId:task.projectId}]:[])
  if(sql.startsWith('SELECT count(*)')&&sql.includes('project_memberships'))return rows([{total:state.members.filter(m=>m.projectId===args[0]&&m.userId!==args[1]).length}])
  if(sql.startsWith('SELECT count(*)')&&sql.includes('project_tasks'))return rows([{total:args[0]==='alpha'?1:0}])
  if(sql.includes('FROM project_memberships m JOIN users'))return rows(state.members.filter(m=>m.projectId===args[0]&&m.userId!==args[1]).slice(args[3],args[3]+args[2]))
  if(sql.includes('FROM project_tasks t WHERE'))return rows((args[0]==='alpha'?[task]:[]).slice(args[2],args[2]+args[1]))
  if(sql.includes('FROM project_tasks t JOIN source_projects'))return rows([])
  throw Error('Unhandled offline SQL: '+sql)
 }}
 const users=createTestRepository(),tokens={}
 for(const [name,id] of Object.entries(ids)){const u={id,email:`${name}@test.example`,fullName:name,role:'Developer',tokenVersion:0};await users.createUser(u);tokens[name]=signToken(u)}
 const app=createApp({userRepository:users,membershipRepository:createMembershipRepository(pool),taskRepository:createTaskRepository(pool)})
 const get=(path,who='member')=>request(app).get(path).set('Authorization',`Bearer ${tokens[who]}`)
 return {app,get,tokens,state,ids,member,task,projects}
}
test('Team discovery is durable, unique, current and separates ownership from membership',async()=>{
 const f=await fixture()
 assert.deepEqual((await f.get('/api/project-members/projects','owner')).body.projects.map(p=>[p.id,p.access]),[['alpha','owner']])
 assert.deepEqual((await f.get('/api/project-members/projects')).body.projects.map(p=>[p.id,p.access]),[['alpha','member']])
 assert.deepEqual((await f.get('/api/project-members/projects','stranger')).body.projects.map(p=>p.id),['beta'])
 const sql=f.state.calls.find(c=>c.sql.includes('CASE WHEN')).sql
 assert.match(sql,/FROM source_projects/);assert.match(sql,/EXISTS/)
 f.state.members=[]
 assert.deepEqual((await f.get('/api/project-members/projects')).body.projects,[])
 assert.equal((await f.get('/api/project-members/projects?unexpected=true')).status,400)
})
test('members read only their current directory and task list with bounded pagination',async()=>{
 const f=await fixture()
 const directory=await f.get('/api/project-members/directory?projectId=alpha&limit=20&offset=0')
 assert.equal(directory.status,200);assert.equal(directory.body.owner.userId,f.ids.owner);assert.equal(directory.body.members[0].userId,f.ids.member)
 const tasks=await f.get('/api/project-tasks/visible?projectId=alpha&limit=20&offset=0')
 assert.equal(tasks.status,200);assert.equal(tasks.body.tasks[0].id,f.task.id)
 assert.equal(tasks.headers['cache-control'],'no-store')
 f.state.members.push(...Array.from({length:20},()=>({...f.member,id:crypto.randomUUID(),userId:crypto.randomUUID()})))
 const older=await f.get('/api/project-members/directory?projectId=alpha&offset=20')
 assert.equal(older.body.members.length,1);assert.equal(older.body.total,21)
 assert.equal((await f.get('/api/project-tasks/visible?projectId=alpha&offset=20')).body.tasks.length,0)
 for(const path of ['/api/project-members/directory?projectId=beta','/api/project-tasks/visible?projectId=beta','/api/project-members/directory?projectId=missing','/api/project-tasks/visible?projectId=missing'])assert.equal((await f.get(path)).status,404,path)
 for(const path of ['/api/project-members/directory?projectId=alpha','/api/project-tasks/visible?projectId=alpha']){
  assert.equal((await f.get(path,'stranger')).status,404)
  assert.equal((await request(f.app).get(path)).status,401)
 }
 assert.equal((await f.get('/api/project-tasks/visible?projectId=alpha&limit=0')).status,400)
 f.state.members=[]
 for(const path of ['/api/project-members/directory?projectId=alpha','/api/project-tasks/visible?projectId=alpha'])assert.equal((await f.get(path)).status,404)
 // Ownership is also rechecked, even when a caller kept an old discovery result.
 assert.equal((await f.get('/api/project-tasks/visible?projectId=alpha','owner')).status,200)
 f.projects[0].ownerId=f.ids.stranger
 assert.equal((await f.get('/api/project-tasks/visible?projectId=alpha','owner')).status,404)
 assert.equal((await f.get('/api/project-members/directory?projectId=alpha','owner')).status,404)
})
test('member and assignee identities never authorize management or owner task details',async()=>{
 const f=await fixture(),auth={Authorization:`Bearer ${f.tokens.member}`}
 for(const [method,path,body] of [
  ['post','/api/project-members',{projectId:'alpha',email:'stranger@test.example',displayRole:'Developer'}],
  ['post','/api/project-tasks',{projectId:'alpha',title:'Forbidden'}],
  ['patch',`/api/project-tasks/${f.task.id}`,{status:'Done'}],
  ['delete',`/api/project-tasks/${f.task.id}`,undefined],
 ]){const req=request(f.app)[method](path).set(auth);assert.equal((await (body?req.send(body):req)).status,404,path)}
 assert.equal((await f.get(`/api/project-tasks/${f.task.id}`)).status,404)
 assert.equal((await f.get('/api/project-members?projectId=alpha')).status,404)
})
test('shared reads fail closed on storage failure with sanitized errors',async()=>{
 const f=await fixture();f.state.broken=true
 for(const path of ['/api/project-members/projects','/api/project-members/directory?projectId=alpha','/api/project-tasks/visible?projectId=alpha']){
  const res=await f.get(path);assert.equal(res.status,503);assert.doesNotMatch(JSON.stringify(res.body),/private storage/)
 }
})
test('shared read authorization locks project then membership inside a current transaction',async()=>{
 const f=await fixture()
 await f.get('/api/project-tasks/visible?projectId=alpha')
 const sql=f.state.calls.map(c=>c.sql)
 const begin=sql.indexOf('BEGIN ISOLATION LEVEL READ COMMITTED')
 const project=sql.findIndex(s=>s.startsWith('SELECT id,owner_id')&&s.endsWith('FOR SHARE'))
 const membership=sql.findIndex(s=>s.startsWith('SELECT id FROM project_memberships')&&s.endsWith('FOR SHARE'))
 const data=sql.findIndex(s=>s.startsWith('SELECT count(*)'))
 assert.ok(begin>=0&&project>begin&&membership>project&&data>membership)
 assert.equal(sql.at(-1),'COMMIT')
 assert.ok(sql.every(s=>!/^INSERT|^UPDATE|^DELETE/.test(s)))
})
