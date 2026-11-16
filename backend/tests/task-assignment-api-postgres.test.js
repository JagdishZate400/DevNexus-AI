require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const fs=require('fs')
const path=require('path')
const {Pool}=require('pg')
const request=require('supertest')
const {createApp}=require('../src/app')
const {createTestRepository}=require('./helpers/users')
const {signToken}=require('../src/middleware/auth')
const {createTaskRepository}=require('../src/db/taskRepository')
const {createSprintRepository}=require('../src/db/sprintRepository')
const {createMembershipRepository}=require('../src/db/membershipRepository')

test('B2 PostgreSQL HTTP assignment, eligibility, privacy, durability and concurrent locks',{
 skip:!process.env.B2_TEST_DATABASE_URL,
},async()=>{
 const connectionString=process.env.B2_TEST_DATABASE_URL,url=new URL(connectionString)
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55451')
 assert.equal(url.pathname,'/devnexus_p0151_acceptance');assert.equal(url.username,'p0151_runner')
 const admin=new Pool({connectionString,connectionTimeoutMillis:5000})
 const schema='assignment_api_test_'+crypto.randomBytes(8).toString('hex')
 let pool
 try{
  assert.deepEqual((await admin.query('SELECT current_database() AS db,current_user AS usr')).rows[0],{db:'devnexus_p0151_acceptance',usr:'p0151_runner'})
  await admin.query(`CREATE SCHEMA ${schema}`)
  const options={connectionString,options:`-c search_path=${schema}`,connectionTimeoutMillis:5000}
  pool=new Pool(options)
  await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/create-users.sql'),'utf8'))
  for(const file of ['0132-source-workspace.sql','0136-source-index.sql','0141-repository-reviews.sql','0142-repository-review-batches.sql','0143-review-scope-foundation.sql','0144-review-finding-type.sql','0145-project-documents.sql','0146-project-tasks.sql','0147-project-sprints.sql','0148-project-memberships.sql','0152-task-assignment.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/migrations',file),'utf8'))
  const users=createTestRepository(),ids={}
  for(const who of ['owner','developer','tester','viewer','nonmember','cross']){
   ids[who]=crypto.randomUUID()
   await pool.query("INSERT INTO users(id,full_name,email,password_hash) VALUES($1,$2,$3,'secret')",[ids[who],'Registered '+who,who+'@b2.test'])
   await users.createUser({id:ids[who],fullName:'Registered '+who,email:who+'@b2.test',role:'Developer'})
  }
  await pool.query("INSERT INTO source_projects(id,owner_id,name) VALUES('owned',$1,'Owned'),('other',$1,'Other')",[ids.owner])
  const members=createMembershipRepository(pool)
  const membershipIds={}
  for(const [who,displayRole] of [['developer','Developer'],['tester','Tester'],['viewer','Viewer'],['cross','Developer']]){
   membershipIds[who]=(await members.create({projectId:who==='cross'?'other':'owned',email:who+'@b2.test',displayRole},ids.owner)).id
  }
  const tasks=createTaskRepository(pool),sprints=createSprintRepository(pool)
  const app=createApp({userRepository:users,taskRepository:tasks,sprintRepository:sprints,membershipRepository:members,
   sourceRepository:require('../src/db/sourceRepository').createSourceRepository(pool),
   documentRepository:require('../src/db/documentRepository').createDocumentRepository(pool),
   reviewRepository:require('../src/db/reviewRepository').createReviewRepository(pool),
   reviewBatchRepository:require('../src/db/reviewBatchRepository').createReviewBatchRepository(pool)})
  const token=async who=>signToken(await users.findById(ids[who]))
  async function api(who,method,route,body){const req=request(app)[method](route).set('Authorization','Bearer '+await token(who));return body===undefined?req:req.send(body)}
  const base={projectId:'owned',title:'Assignment task',description:'Keep description',priority:'High'}
  let res=await api('owner','post','/api/project-tasks',{...base,assigneeUserId:ids.developer})
  assert.equal(res.status,201);const id=res.body.task.id
  const sprint=await sprints.create({projectId:'owned',name:'Sprint',startDate:'2026-10-16',endDate:'2026-10-17'},ids.owner)
  await sprints.assign(sprint.id,id,ids.owner)
  for(const who of ['owner','developer','tester','viewer']){
   res=await api('owner','patch','/api/project-tasks/'+id,{assigneeUserId:ids[who].toUpperCase()})
   assert.equal(res.status,200)
   assert.equal(res.body.task.assigneeUserId,ids[who]);assert.equal(res.body.task.sprintId,sprint.id)
   assert.deepEqual(res.body.task.assignee,{userId:ids[who],displayName:'Registered '+who,email:who+'@b2.test'})
   assert.equal(res.body.task.description,base.description);assert.equal(res.body.task.priority,'High')
  }
  res=await api('owner','patch','/api/project-tasks/'+id,{status:'Done',description:''})
  assert.equal(res.status,200);assert.equal(res.body.task.assigneeUserId,ids.viewer);assert.equal(res.body.task.description,'')
  const saved=res.body.task
  assert.deepEqual((await api('owner','get','/api/project-tasks?projectId=owned')).body.tasks[0],saved)
  assert.deepEqual((await api('owner','get',`/api/project-sprints/${sprint.id}/tasks`)).body.tasks[0],saved)
  await pool.end();pool=new Pool(options)
  assert.equal((await createTaskRepository(pool).read(id,ids.owner)).assigneeUserId,ids.viewer)
  // Existing repository pool was deliberately closed; make a fresh app for subsequent checks.
  const freshTasks=createTaskRepository(pool)
  app.locals.taskRepository=freshTasks;app.locals.sprintRepository=createSprintRepository(pool)
  app.locals.sourceRepository=require('../src/db/sourceRepository').createSourceRepository(pool)
  app.locals.documentRepository=require('../src/db/documentRepository').createDocumentRepository(pool)
  app.locals.reviewRepository=require('../src/db/reviewRepository').createReviewRepository(pool)
  app.locals.reviewBatchRepository=require('../src/db/reviewBatchRepository').createReviewBatchRepository(pool)
  const before=await freshTasks.read(id,ids.owner),errors=[]
  for(const assigneeUserId of [crypto.randomUUID(),ids.nonmember,ids.cross])for(const method of ['post','patch']){
   const result=await api('owner',method,'/api/project-tasks'+(method==='patch'?'/'+id:''),method==='patch'?{title:'Must not save',assigneeUserId}:{...base,assigneeUserId})
   assert.equal(result.status,400);errors.push({code:result.body.code,message:result.body.message})
  }
  assert(errors.every(e=>JSON.stringify(e)===JSON.stringify(errors[0])));assert.equal(errors[0].code,'assignee_not_eligible')
  assert.deepEqual(await freshTasks.read(id,ids.owner),before)
  for(const value of ['bad',1,{},'owner@b2.test'])assert.equal((await api('owner','patch','/api/project-tasks/'+id,{assigneeUserId:value})).status,400)
  for(const key of ['assignee','assigneeEmail','email','displayName','userId'])assert.equal((await api('owner','patch','/api/project-tasks/'+id,{[key]:'forged'})).status,400)
  for(const who of ['developer','tester','viewer']){
   await freshTasks.update(id,ids.owner,{assigneeUserId:ids[who]})
   for(const route of ['/api/project-tasks?projectId=owned','/api/project-tasks/'+id,'/api/project-sprints?projectId=owned',`/api/project-sprints/${sprint.id}/tasks`,'/api/workspace/projects/owned/files','/api/project-documents?projectId=owned','/api/repository-reviews/'+crypto.randomUUID(),'/api/repository-review-batches/preview?projectId=owned'])assert.equal((await api(who,'get',route)).status,404,route)
   for(const method of ['patch','delete'])assert.equal((await api(who,method,'/api/project-tasks/'+id,method==='patch'?{assigneeUserId:ids[who]}:undefined)).status,404)
   assert.equal((await api(who,'post','/api/project-tasks',{...base,assigneeUserId:ids[who]})).status,404)
  }
  const config=require('../src/config'),oldProvider=config.aiProvider;config.aiProvider='gemini'
  try{
   assert.equal((await api('viewer','post','/api/repository-reviews',{projectId:'owned',fileId:crypto.randomUUID()})).status,404)
   assert.equal((await api('viewer','post','/api/ai/ask',{projectId:'owned',message:'Read private code'})).status,404)
  }finally{config.aiProvider=oldProvider}
  res=await api('owner','patch','/api/project-tasks/'+id,{assigneeUserId:null})
  assert.equal(res.status,200);assert.equal(res.body.task.assignee,null);assert.equal(res.body.task.assigneeUserId,null);assert.equal(res.body.task.sprintId,sprint.id)
  for(const body of [base,{...base,assigneeUserId:null}]){
   res=await api('owner','post','/api/project-tasks',body)
   assert.equal(res.status,201);assert.equal(res.body.task.assigneeUserId,null);assert.equal(res.body.task.assignee,null)
  }

  // Pause after a real row lock, then prove the competing SQL is waiting on it.
  async function race(pauseSql,write,competingSql,args){
   let reached,release
   const ready=new Promise(resolve=>{reached=resolve}),gate=new Promise(resolve=>{release=resolve})
   const wrapped={async connect(){const c=await pool.connect();return {release:()=>c.release(),async query(sql,args){const result=await c.query(sql,args);if(sql===pauseSql){reached();await gate}return result}}}}
   const competing=await pool.connect();let pendingWrite,pendingSql
   try{
    const pid=(await competing.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    pendingWrite=write(createTaskRepository(wrapped));await ready
    pendingSql=competing.query(competingSql,args)
    const deadline=Date.now()+3000;let blocked=false
    while(Date.now()<deadline){if((await pool.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked){blocked=true;break}await new Promise(resolve=>setTimeout(resolve,10))}
    assert.equal(blocked,true,'competing mutation must wait for assignment transaction lock')
    release();await pendingWrite;await pendingSql
   }finally{release();await Promise.allSettled([pendingWrite,pendingSql]);competing.release()}
  }
  await race('SELECT id FROM project_memberships WHERE project_id=$1 AND user_id=$2 FOR SHARE',repo=>repo.update(id,ids.owner,{assigneeUserId:ids.viewer}),'DELETE FROM project_memberships WHERE id=$1',[membershipIds.viewer])
  assert.equal((await freshTasks.read(id,ids.owner)).assigneeUserId,ids.viewer)
  await assert.rejects(freshTasks.update(id,ids.owner,{assigneeUserId:ids.viewer}),e=>e.code==='assignee_not_eligible')
  assert.equal((await freshTasks.update(id,ids.owner,{priority:'Low'})).assigneeUserId,ids.viewer)
  await race('SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',repo=>repo.update(id,ids.owner,{assigneeUserId:ids.owner}),'UPDATE source_projects SET owner_id=$2 WHERE id=$1',['owned',ids.nonmember])
  assert.equal(await freshTasks.read(id,ids.owner),null)
  assert.equal((await freshTasks.read(id,ids.nonmember)).assigneeUserId,ids.owner)
  await assert.rejects(freshTasks.update(id,ids.owner,{assigneeUserId:null}),e=>e.code==='not_found')
  await assert.rejects(freshTasks.update(id,ids.nonmember,{assigneeUserId:ids.owner}),e=>e.code==='assignee_not_eligible')
 }finally{
  if(pool)await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()
 }
})
