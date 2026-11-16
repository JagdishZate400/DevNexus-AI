require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const request=require('supertest')
const {createApp}=require('../src/app')
const {createTestRepository}=require('./helpers/users')
const {signToken}=require('../src/middleware/auth')
const {createMembershipRepository}=require('../src/db/membershipRepository')
const v=require('../src/services/membershipValidation')
function database(){
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),projects=new Map([['owned-directory',owner],['second-directory',owner],['foreign-directory',other]])
 const users=new Map(),calls=[];let members=[],assignedTasks=[],snapshot,broken=false
 function user(id,email){const u={id,email,fullName:'Registered user',passwordHash:'private-hash',tokenVersion:9,role:'Developer'};users.set(id,u);return u}
 const ownerUser=user(owner,'owner@directory.test'),memberUser=user(crypto.randomUUID(),'member@directory.test')
 user(other,'other@directory.test')
 const safe=m=>({...m,displayName:users.get(m.userId).fullName,email:users.get(m.userId).email})
 const rows=value=>({rows:structuredClone(value)})
 const pool={async connect(){return {query:pool.query,release(){}}},async query(sql,args=[]){
  calls.push({sql,args})
  if(sql.startsWith('BEGIN')){snapshot=structuredClone({members,assignedTasks});return rows([])}
  if(sql==='ROLLBACK'){members=snapshot.members;assignedTasks.splice(0,assignedTasks.length,...snapshot.assignedTasks);return rows([])}
  if(sql==='COMMIT'){if(broken)throw new Error('private database password');return rows([])}
  if(sql.startsWith('SET LOCAL')||sql.startsWith('SAVEPOINT ')||sql.startsWith('RELEASE SAVEPOINT ')||sql.startsWith('ROLLBACK TO SAVEPOINT ')||sql.startsWith('SELECT set_config'))return rows([])
   if(sql.startsWith('SELECT current_setting'))return rows([{context:''}])
  if(sql.startsWith('SELECT id FROM source_projects') || sql.startsWith('SELECT id, name FROM source_projects'))return rows(projects.get(args[0])===args[1]?[{id:args[0],name:'Owned'}]:[])
  if(sql.startsWith('SELECT id AS "userId"')){const u=users.get(args[0]);return rows(u?[{userId:u.id,displayName:u.fullName,email:u.email}]:[])}
  if(sql.startsWith('SELECT id FROM users WHERE lower'))return rows([...users.values()].filter(u=>u.email.toLowerCase()===args[0].toLowerCase()).map(u=>({id:u.id})))
  if(sql.startsWith('INSERT INTO project_memberships')){
   const [id,projectId,userId,,displayRole]=args
   if(members.some(m=>m.projectId===projectId && m.userId===userId))return rows([])
   members.push({id,projectId,userId,displayRole,createdAt:'2026-10-15',updatedAt:'2026-10-15'});return rows([{id}])
  }
  if(sql.startsWith('SELECT project_id AS'))return rows(members.filter(m=>m.id===args[0]).map(m=>({projectId:m.projectId})))
  if(sql.startsWith('SELECT id,user_id'))return rows(members.filter(m=>m.id===args[0] && m.userId!==args[1]))
  if(sql.startsWith('SELECT count(*)'))return rows([{total:members.filter(m=>m.projectId===args[0] && m.userId!==args[1]).length}])
  if(sql.startsWith('SELECT') && sql.includes('FROM project_memberships m'))return rows(sql.includes('WHERE m.id=$1')?members.filter(m=>m.id===args[0]).map(safe):members.filter(m=>m.projectId===args[0] && m.userId!==args[1]).sort((a,b)=>b.id.localeCompare(a.id)).slice(args[3],args[3]+args[2]).map(safe))
  if(sql.startsWith('UPDATE project_memberships')){members.find(m=>m.id===args[0]).displayRole=args[1];return rows([])}
  if(sql.startsWith('UPDATE project_tasks')){for(const task of assignedTasks)if(task.projectId===args[0]&&task.assigneeUserId===args[1]){task.assigneeUserId=null;task.updatedAt='updated'}return rows([])}
  if(sql.startsWith('DELETE FROM project_memberships')){members=members.filter(m=>m.id!==args[0]);return rows([])}
  if(sql.includes('JOIN source_projects p') && sql.includes('p.owner_id=$2'))return rows([])
  throw new Error('Unhandled directory fixture SQL')
 }}
 return {assignedTasks,owner,other,ownerUser,memberUser,users,projects,pool,calls,repo:createMembershipRepository(pool),user,breakCommit(){broken=true}}
}
async function fixture(){
 const f=database(),auth=createTestRepository(),tokens=[]
 await auth.createUser(f.ownerUser);await auth.createUser(f.memberUser)
 for(const role of ['Developer','Team Lead','Project Manager']){const u=f.user(crypto.randomUUID(),crypto.randomUUID()+'@directory.test');u.role=role;await auth.createUser(u);tokens.push(signToken(u))}
 const options={userRepository:auth,membershipRepository:f.repo}
 return {...f,auth,options,tokens,token:signToken(f.ownerUser),memberToken:signToken(f.memberUser),app:createApp(options)}
}
const body={projectId:'owned-directory',email:'member@directory.test',displayRole:'Tester'}
function call(f,method,path='',payload,token=f.token){const req=request(f.app)[method]('/api/project-members'+path).set('Authorization','Bearer '+token);return payload===undefined?req:req.send(payload)}

test('B3 member removal atomically clears only that project/user and preserves task data',async()=>{
 const f=await fixture(),member=await f.repo.create(body,f.owner)
 const task={projectId:body.projectId,assigneeUserId:f.memberUser.id,title:'Keep',description:'Body',status:'Done',priority:'High',creatorId:f.owner,sprintId:crypto.randomUUID(),updatedAt:'before'}
 f.assignedTasks.push({...task},{...task,projectId:'second-directory'},{...task,assigneeUserId:f.owner})
 const before=structuredClone(f.assignedTasks)
 assert.equal((await call(f,'delete','/'+member.id)).status,204)
 assert.deepEqual(f.assignedTasks[0],{...before[0],assigneeUserId:null,updatedAt:'updated'})
 assert.deepEqual(f.assignedTasks.slice(1),before.slice(1))
 const projectLock=f.calls.findIndex(c=>c.sql==='SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR UPDATE')
 const cleanup=f.calls.findIndex(c=>c.sql.startsWith('UPDATE project_tasks'))
 assert(projectLock>=0&&cleanup>projectLock)
 const again=await f.repo.create(body,f.owner);f.assignedTasks[0]={...task}
 f.breakCommit();assert.equal((await call(f,'delete','/'+again.id)).status,503)
 assert.deepEqual(f.assignedTasks[0],task)
 assert.equal((await f.pool.query('SELECT count(*) AS total FROM project_memberships WHERE project_id=$1 AND user_id<>$2',[body.projectId,f.owner])).rows[0].total,1)
})
test('membership CRUD, safe user projection, separate owner and persistence through repository recreation',async()=>{
 const f=await fixture(),created=await call(f,'post','',{...body,email:' MEMBER@directory.test '})
 assert.equal(created.status,201);const m=created.body.member
 assert.equal(m.userId,f.memberUser.id);assert.equal(m.displayRole,'Tester');assert.equal(m.projectId,body.projectId)
 assert.deepEqual(Object.keys(m).sort(),['id','projectId','userId','displayName','email','displayRole','createdAt','updatedAt'].sort())
 assert.doesNotMatch(JSON.stringify(m),/password|tokenVersion|private-hash|addedBy/)
 for(const role of v.DISPLAY_ROLES)assert.equal((await call(f,'patch','/'+m.id,{displayRole:role})).body.member.displayRole,role)
 const restarted=createMembershipRepository(f.pool),saved=await restarted.list(f.owner,{projectId:body.projectId})
 assert.equal(saved.members[0].displayRole,'Viewer');assert.equal(saved.owner.userId,f.owner);assert.equal(saved.total,1)
 assert.equal(f.users.get(f.memberUser.id).role,'Developer');assert.equal(f.projects.get(body.projectId),f.owner)
 assert.equal((await call(f,'delete','/'+m.id)).status,204);assert.equal((await restarted.list(f.owner,{projectId:body.projectId})).total,0)
 assert.equal((await call(f,'delete','/'+m.id)).status,404)
})
test('duplicate, unknown email and owner additions have identical non-enumerating conflicts',async()=>{
 const f=await fixture();await call(f,'post','',body)
 const results=[]
 for(const email of [body.email,'unknown@directory.test',f.ownerUser.email]){const result=await call(f,'post','',{...body,email});assert.equal(result.status,409);results.push({code:result.body.code,message:result.body.message})}
 assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2])
 assert.equal((await f.repo.list(f.owner,{projectId:body.projectId})).total,1)
})
test('all directory endpoints require authentication and current project ownership, never role bypass',async()=>{
 const f=await fixture(),m=await f.repo.create(body,f.owner)
 const ops=[['get','?projectId='+body.projectId],['post','',body],['patch','/'+m.id,{displayRole:'Viewer'}],['delete','/'+m.id]]
 for(const [method,path,payload] of ops){assert.equal((await call(f,method,path,payload,'invalid')).status,401);for(const token of [...f.tokens,f.memberToken])assert.equal((await call(f,method,path,payload,token)).status,404)}
 assert.equal((await call(f,'post','',{...body,projectId:'foreign-directory'})).status,404)
})
test('ownership transfer hides current owner membership and original owner loses all access',async()=>{
 const f=database(),m=await f.repo.create(body,f.owner);f.projects.set(body.projectId,f.memberUser.id)
 await assert.rejects(f.repo.list(f.owner,{projectId:body.projectId}),e=>e.code==='not_found')
 await assert.rejects(f.repo.update(m.id,f.owner,{displayRole:'Developer'}),e=>e.code==='not_found')
 await assert.rejects(f.repo.remove(m.id,f.owner),e=>e.code==='not_found')
 const page=await f.repo.list(f.memberUser.id,{projectId:body.projectId});assert.equal(page.owner.userId,f.memberUser.id);assert.equal(page.total,0)
 await assert.rejects(f.repo.remove(m.id,f.memberUser.id),e=>e.code==='not_found')
 await assert.rejects(f.repo.update(m.id,f.memberUser.id,{displayRole:'Viewer'}),e=>e.code==='not_found')
 await assert.rejects(f.repo.create(body,f.memberUser.id),e=>e.code==='member_not_added')
 const added=await f.repo.create({...body,email:f.ownerUser.email},f.memberUser.id);assert.equal(added.userId,f.owner)
})
test('validation rejects invalid roles, arbitrary IDs, privilege fields and malformed pagination',async()=>{
 const f=await fixture(),m=await f.repo.create(body,f.owner)
 for(const payload of [{...body,displayRole:'Project Manager'},{...body,displayRole:null},{...body,email:'invalid'}, {...body,email:'x'.repeat(255)+'@test.test'},{...body,userId:f.owner},{...body,projectId:'../bad'},{...body,role:'Lead'},[]])assert.throws(()=>v.input(payload))
 for(const payload of [{},{displayRole:'Lead'},{displayRole:'Viewer',userId:f.owner},{displayRole:'Viewer',projectId:'second-directory'}])assert.equal((await call(f,'patch','/'+m.id,payload)).status,400)
 assert.equal((await call(f,'post','',{...body,displayRole:'Lead'})).status,400)
 for(const path of ['', '?projectId=owned-directory&limit=0','?projectId=owned-directory&limit=51','?projectId=owned-directory&offset=-1','?projectId=owned-directory&email=x'])assert.equal((await call(f,'get',path)).status,400)
 for(const method of ['patch','delete'])assert.equal((await call(f,method,'/invalid',method==='patch'?{displayRole:'Viewer'}:undefined)).status,400)
})
test('pagination is deterministic, bounded and project scoped; empty project includes separate owner',async()=>{
 const f=database()
 for(let i=0;i<3;i++){const u=f.user(crypto.randomUUID(),`member${i}@directory.test`);await f.repo.create({...body,email:u.email},f.owner)}
 await f.repo.create({...body,projectId:'second-directory'},f.owner)
 const a=await f.repo.list(f.owner,{projectId:body.projectId,limit:'2'}),b=await f.repo.list(f.owner,{projectId:body.projectId,limit:'2',offset:'2'})
 assert.equal(a.total,3);assert.equal(a.members.length,2);assert.equal(b.members.length,1);assert.ok(!a.members.some(m=>m.id===b.members[0].id))
 const empty=database(),page=await empty.repo.list(empty.owner,{projectId:body.projectId});assert.equal(page.total,0);assert.deepEqual(page.members,[]);assert.equal(page.owner.userId,empty.owner)
 assert.ok(f.calls.some(c=>c.sql==='BEGIN ISOLATION LEVEL REPEATABLE READ'))
})
test('member additions are rate limited per authenticated user, including unknown addresses',async()=>{
 const f=await fixture()
 for(let i=0;i<10;i++)assert.equal((await call(f,'post','',{...body,email:'unknown@directory.test'})).status,409)
 const limited=await call(f,'post','',body);assert.equal(limited.status,429);assert.equal(limited.body.code,'member_add_rate_limited')
 assert.equal((await call(f,'get','?projectId='+body.projectId)).status,200)
})
test('storage failures roll back and return sanitized errors without memory fallback',async()=>{
 const f=await fixture();f.breakCommit();const r=await call(f,'post','',body)
 assert.equal(r.status,503);assert.equal(r.body.code,'membership_storage_unavailable');assert.doesNotMatch(JSON.stringify(r.body),/private|password/)
 assert.ok(f.calls.some(c=>c.sql==='ROLLBACK'))
 assert.equal((await f.pool.query('SELECT count(*) AS total FROM project_memberships WHERE project_id=$1 AND user_id<>$2',[body.projectId,f.owner])).rows[0].total,0)
 assert.ok(f.calls.filter(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)).every(c=>c.sql.includes('project_memberships')||c.sql.startsWith('UPDATE project_tasks')))
})
test('directory membership grants no source, document, task, sprint, review or repository chat access',async()=>{
 const f=await fixture();await f.repo.create(body,f.owner)
 const {createSourceRepository}=require('../src/db/sourceRepository'),{createTaskRepository}=require('../src/db/taskRepository'),{createSprintRepository}=require('../src/db/sprintRepository'),{createDocumentRepository}=require('../src/db/documentRepository'),{createReviewRepository}=require('../src/db/reviewRepository')
 const app=createApp({...f.options,sourceRepository:createSourceRepository(f.pool),taskRepository:createTaskRepository(f.pool),sprintRepository:createSprintRepository(f.pool),documentRepository:createDocumentRepository(f.pool),reviewRepository:createReviewRepository(f.pool)})
 const auth='Bearer '+f.memberToken
 for(const path of ['/api/workspace/projects/owned-directory/files','/api/project-tasks?projectId=owned-directory','/api/project-sprints?projectId=owned-directory','/api/project-documents?projectId=owned-directory','/api/repository-reviews/'+crypto.randomUUID()])assert.equal((await request(app).get(path).set('Authorization',auth)).status,404,path)
 const config=require('../src/config'),previous=config.aiProvider;config.aiProvider='gemini'
 try{
  assert.equal((await request(app).post('/api/repository-reviews').set('Authorization',auth).send({projectId:body.projectId,fileId:crypto.randomUUID()})).status,404)
  assert.equal((await request(app).post('/api/ai/ask').set('Authorization',auth).send({projectId:body.projectId,message:'Explain source'})).status,404)
 }finally{config.aiProvider=previous}
})
