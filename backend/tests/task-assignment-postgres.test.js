require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const fs=require('fs')
const path=require('path')
const {Pool}=require('pg')
const {createTaskRepository}=require('../src/db/taskRepository')
const {createSprintRepository}=require('../src/db/sprintRepository')

// Running this test applies migrations: separate approval and an explicit disposable URL required.
test('B1 PostgreSQL preservation, FK behavior, durable projections and owner authorization',{
 skip:process.env.ASSIGNMENT_MIGRATION_TEST_APPROVED!=='yes'||!process.env.ASSIGNMENT_TEST_DATABASE_URL,
},async()=>{
 const connectionString=process.env.ASSIGNMENT_TEST_DATABASE_URL
 assert.notEqual(new URL(connectionString).pathname,'/devnexus_ai')
 const schema='assignment_test_'+crypto.randomBytes(8).toString('hex')
 const admin=new Pool({connectionString,connectionTimeoutMillis:5000})
 let pool
 try{
  await admin.query(`CREATE SCHEMA ${schema}`)
  const options={connectionString,options:`-c search_path=${schema}`,connectionTimeoutMillis:5000}
  pool=new Pool(options)
  await pool.query('CREATE TABLE users(id UUID PRIMARY KEY,full_name TEXT,email TEXT,password_hash TEXT)')
  for(const file of ['0132-source-workspace.sql','0146-project-tasks.sql','0147-project-sprints.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/migrations',file),'utf8'))
  const owner=crypto.randomUUID(),member=crypto.randomUUID(),id=crypto.randomUUID()
  await pool.query("INSERT INTO users VALUES($1,'Owner','owner@test','secret'),($2,'Member','member@test','secret')",[owner,member])
  await pool.query("INSERT INTO source_projects(id,owner_id,name) VALUES('owned',$1,'Owned')",[owner])
  await pool.query("INSERT INTO project_tasks(id,project_id,creator_id,title) VALUES($1,'owned',$2,'Existing')",[id,owner])
  const before=(await pool.query('SELECT * FROM project_tasks')).rows[0]
  await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/migrations/0152-task-assignment.sql'),'utf8'))
  const {assignee_user_id,...after}=(await pool.query('SELECT * FROM project_tasks')).rows[0]
  assert.equal(assignee_user_id,null);assert.deepEqual(after,before)
  let tasks=createTaskRepository(pool)
  const unassigned=await tasks.read(id,owner)
  assert.equal(unassigned.assigneeUserId,null);assert.equal(unassigned.assignee,null);assert.equal(unassigned.sprintId,null)
  const created=await tasks.create({projectId:'owned',title:'New'},owner)
  assert.equal(created.assignee,null);assert.equal(created.assigneeUserId,null)
  await assert.rejects(pool.query('UPDATE project_tasks SET assignee_user_id=$2 WHERE id=$1',[id,crypto.randomUUID()]),e=>e.code==='23503')
  // Fixture SQL only: no assignment API writes are enabled.
  await pool.query('UPDATE project_tasks SET assignee_user_id=$2 WHERE id=$1',[id,member])
  const sprints=createSprintRepository(pool)
  const sprint=await sprints.create({projectId:'owned',name:'Sprint',startDate:'2026-10-16',endDate:'2026-10-17'},owner)
  await sprints.assign(sprint.id,id,owner)
  await pool.end();pool=new Pool(options);tasks=createTaskRepository(pool)
  const saved=await tasks.read(id,owner)
  assert.equal(saved.assigneeUserId,member);assert.equal(saved.sprintId,sprint.id)
  assert.deepEqual(saved.assignee,{userId:member,displayName:'Member',email:'member@test'})
  assert.deepEqual((await tasks.list(owner,{projectId:'owned'})).tasks.find(t=>t.id===id),saved)
  assert.deepEqual((await createSprintRepository(pool).tasks(sprint.id,owner,{})).tasks[0],saved)
  assert.deepEqual((await tasks.update(id,owner,{title:'Edited'})).assignee,saved.assignee)
  assert.equal(await tasks.read(id,member),null)
  await assert.rejects(tasks.update(id,member,{status:'Done'}),e=>e.code==='not_found')
  await pool.query('DELETE FROM users WHERE id=$1',[member])
  assert.equal((await tasks.read(id,owner)).assigneeUserId,null)
  assert.equal((await tasks.read(id,owner)).assignee,null)
 }finally{
  if(pool)await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()
 }
})
