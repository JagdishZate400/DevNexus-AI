require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const fs=require('fs')
const path=require('path')
const {Pool}=require('pg')
const {createTaskRepository}=require('../src/db/taskRepository')
// Explicit disposable test database only; never falls back to DATABASE_URL.
test('PostgreSQL project task migration, owner-scoped CRUD and persistence across pools',{skip:!process.env.TASK_TEST_DATABASE_URL},async()=>{
 const schema=`task_test_${crypto.randomBytes(8).toString('hex')}`,connectionString=process.env.TASK_TEST_DATABASE_URL
 const admin=new Pool({connectionString,connectionTimeoutMillis:5000});let pool,restarted
 try{
  await admin.query(`CREATE SCHEMA ${schema}`)
  const options={connectionString,options:`-c search_path=${schema}`,connectionTimeoutMillis:5000}
  pool=new Pool(options);await pool.query('CREATE TABLE users(id UUID PRIMARY KEY,full_name TEXT,email TEXT)')
  for(const name of ['0132-source-workspace.sql','0146-project-tasks.sql','0147-project-sprints.sql','0152-task-assignment.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/migrations',name),'utf8'))
  const owner=crypto.randomUUID(),other=crypto.randomUUID()
  await pool.query('INSERT INTO users(id) VALUES($1),($2)',[owner,other])
  await pool.query('INSERT INTO source_projects(id,owner_id,name) VALUES($1,$2,$3),($4,$5,$6)',['owned',owner,'Owned','foreign',other,'Other'])
  let repo=createTaskRepository(pool)
  const task=await repo.create({projectId:'owned',title:'Persist task'},owner)
  for(const status of ['In Progress','Done','To Do'])assert.equal((await repo.update(task.id,owner,{status})).status,status)
  await repo.update(task.id,owner,{description:'Persisted description',priority:'High',status:'Done'})
  await pool.end();pool=null;restarted=new Pool(options);repo=createTaskRepository(restarted)
  const saved=await repo.read(task.id,owner);assert.equal(saved.status,'Done');assert.equal(saved.description,'Persisted description');assert.equal(saved.priority,'High');assert.equal(saved.creatorId,owner)
  assert.equal(await repo.read(task.id,other),null)
  for(const run of [()=>repo.list(other,{projectId:'owned'}),()=>repo.create({projectId:'foreign',title:'Forbidden'},owner),()=>repo.update(task.id,other,{status:'Done'}),()=>repo.remove(task.id,other)])await assert.rejects(run(),e=>e.code==='not_found')
  assert.equal((await repo.list(owner,{projectId:'owned',limit:'1',offset:'0'})).total,1)
  // Prove database constraints reject invalid status inside a rollback-only transaction.
  const client=await restarted.connect()
  try{await client.query('BEGIN');await assert.rejects(client.query('UPDATE project_tasks SET status=$2 WHERE id=$1',[task.id,'Todo']),e=>e.code==='23514');await client.query('ROLLBACK')}finally{client.release()}
  assert.equal((await repo.read(task.id,owner)).status,'Done')
  await repo.remove(task.id,owner);assert.equal(await repo.read(task.id,owner),null)
 }finally{if(pool)await pool.end();if(restarted)await restarted.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()}
})
