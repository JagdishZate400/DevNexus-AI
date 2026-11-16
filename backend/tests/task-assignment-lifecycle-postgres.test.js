require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const fs=require('fs')
const path=require('path')
const {Pool}=require('pg')
const {createTaskRepository}=require('../src/db/taskRepository')
const {createMembershipRepository}=require('../src/db/membershipRepository')
const {createSprintRepository}=require('../src/db/sprintRepository')

// This test applies the NEW lifecycle migration. Do not enable before separate approval.
test('B3 lifecycle PostgreSQL acceptance (requires separate migration approval)',{
 skip:process.env.LIFECYCLE_MIGRATION_TEST_APPROVED!=='yes'||!process.env.B3_TEST_DATABASE_URL,
},async t=>{
 const connectionString=process.env.B3_TEST_DATABASE_URL,url=new URL(connectionString)
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55451')
 assert.equal(url.pathname,'/devnexus_p0151_acceptance');assert.equal(url.username,'p0151_runner')
 const admin=new Pool({connectionString,connectionTimeoutMillis:5000})
 const schema='lifecycle_test_'+crypto.randomBytes(8).toString('hex');let pool
 try{
  assert.deepEqual((await admin.query('SELECT current_database() AS db,current_user AS usr')).rows[0],{db:'devnexus_p0151_acceptance',usr:'p0151_runner'})
  await admin.query(`CREATE SCHEMA ${schema}`)
  pool=new Pool({connectionString,options:`-c search_path=${schema}`,connectionTimeoutMillis:5000})
  // Clone the already verified B1 schema; do not replay any other migration.
  const tables=['users','source_projects','project_tasks','project_sprints','project_memberships']
  for(const table of tables)await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`)
  const foreignKeys=(await pool.query(`SELECT c.relname,con.conname,pg_get_constraintdef(con.oid) AS definition
   FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND con.contype='f' AND c.relname=ANY($1::text[])`,[tables])).rows
  for(const fk of foreignKeys){
   assert(tables.includes(fk.relname));assert(/^[a-z0-9_]+$/.test(fk.conname))
   await pool.query(`ALTER TABLE ${fk.relname} ADD CONSTRAINT ${fk.conname} ${fk.definition.replaceAll('REFERENCES public.','REFERENCES ')}`)
  }
  await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/migrations/0153-task-assignment-lifecycle.sql'),'utf8'))
  const ids={}
  for(const who of ['owner','member','newowner','outsider']){
   ids[who]=crypto.randomUUID()
   await pool.query("INSERT INTO users(id,full_name,email,password_hash) VALUES($1,$2,$3,'private')",[ids[who],who,who+'@b3.test'])
  }
  const tasks=createTaskRepository(pool),members=createMembershipRepository(pool),sprints=createSprintRepository(pool)
  let counter=0
  async function fixture(){
   const projectId='life_'+(++counter)
   await pool.query('INSERT INTO source_projects(id,owner_id,name) VALUES($1,$2,$1)',[projectId,ids.owner])
   const member=await members.create({projectId,email:'member@b3.test',displayRole:'Viewer'},ids.owner)
   const sprint=await sprints.create({projectId,name:'Keep sprint',startDate:'2026-10-16',endDate:'2026-10-17'},ids.owner)
   const task=await tasks.create({projectId,title:'Keep title',description:'Keep description',status:'Done',priority:'High',assigneeUserId:ids.member},ids.owner)
   await sprints.assign(sprint.id,task.id,ids.owner)
   await pool.query("UPDATE project_tasks SET updated_at='2001-01-01' WHERE id=$1",[task.id])
   return {projectId,member,sprint,task:await tasks.read(task.id,ids.owner)}
  }
  async function assertCleared(before,ownerId=ids.owner){
   const after=await tasks.read(before.id,ownerId)
   const {assigneeUserId:_id,assignee:_user,updatedAt:_updated,...oldFields}=before
   const {assigneeUserId,assignee,updatedAt,...newFields}=after
   assert.equal(assigneeUserId,null);assert.equal(assignee,null)
   assert(updatedAt>before.updatedAt);assert.deepEqual(newFields,oldFields)
  }
  async function invariant(projectId){
   assert.equal((await pool.query(`SELECT count(*)::int AS n FROM project_tasks t JOIN source_projects p ON p.id=t.project_id
    WHERE t.project_id=$1 AND t.assignee_user_id IS NOT NULL AND t.assignee_user_id<>p.owner_id
    AND NOT EXISTS(SELECT 1 FROM project_memberships m WHERE m.project_id=t.project_id AND m.user_id=t.assignee_user_id)`,[projectId])).rows[0].n,0)
  }
  await t.test('API removal clears one project/user and preserves content and sprint summary',async()=>{
   const a=await fixture(),b=await fixture()
   const ownerTask=await tasks.create({projectId:a.projectId,title:'Owner',assigneeUserId:ids.owner},ids.owner)
   const sprintBefore=await sprints.read(a.sprint.id,ids.owner)
   await members.remove(a.member.id,ids.owner)
   await assertCleared(a.task)
   assert.deepEqual(await tasks.read(b.task.id,ids.owner),b.task)
   assert.equal((await tasks.read(ownerTask.id,ids.owner)).assigneeUserId,ids.owner)
   assert.deepEqual(await sprints.read(a.sprint.id,ids.owner),sprintBefore)
   await invariant(a.projectId)
  })
  await t.test('direct membership DELETE cleans up transactionally, retaining a current owner',async()=>{
   const a=await fixture()
   const c=await pool.connect()
   try{
    await c.query('BEGIN');await c.query('DELETE FROM project_memberships WHERE id=$1',[a.member.id])
    assert.equal((await c.query('SELECT assignee_user_id FROM project_tasks WHERE id=$1',[a.task.id])).rows[0].assignee_user_id,null)
    await c.query('ROLLBACK')
   }finally{c.release()}
   assert.deepEqual(await tasks.read(a.task.id,ids.owner),a.task)
   await pool.query('DELETE FROM project_memberships WHERE id=$1',[a.member.id]);await assertCleared(a.task)
   // A raw directory row for the current owner must not revoke owner eligibility.
   await pool.query("INSERT INTO project_memberships(id,project_id,user_id,added_by,display_role) VALUES($1,$2,$3,$3,'Developer')",[crypto.randomUUID(),a.projectId,ids.owner])
   await tasks.update(a.task.id,ids.owner,{assigneeUserId:ids.owner})
   await pool.query('DELETE FROM project_memberships WHERE project_id=$1 AND user_id=$2',[a.projectId,ids.owner])
   assert.equal((await tasks.read(a.task.id,ids.owner)).assigneeUserId,ids.owner)
  })
  await t.test('ownership changes keep new owner/members and clear former nonmember owner',async()=>{
   const a=await fixture(),b=await fixture()
   await members.create({projectId:a.projectId,email:'newowner@b3.test',displayRole:'Tester'},ids.owner)
   const next=await tasks.create({projectId:a.projectId,title:'New owner',assigneeUserId:ids.newowner},ids.owner)
   const former=await tasks.create({projectId:a.projectId,title:'Former',assigneeUserId:ids.owner},ids.owner)
   await pool.query("UPDATE project_tasks SET updated_at='2001-01-01' WHERE id=$1",[former.id])
   const before=await tasks.read(former.id,ids.owner)
   await pool.query('UPDATE source_projects SET owner_id=$2 WHERE id=$1',[a.projectId,ids.newowner])
   await assertCleared(before,ids.newowner)
   assert.equal((await tasks.read(a.task.id,ids.newowner)).assigneeUserId,ids.member)
   assert.equal((await tasks.read(next.id,ids.newowner)).assigneeUserId,ids.newowner)
   assert.deepEqual(await tasks.read(b.task.id,ids.owner),b.task)
   assert.equal(await tasks.read(a.task.id,ids.owner),null)
   await assert.rejects(tasks.update(a.task.id,ids.owner,{title:'Unauthorized'}),e=>e.code==='not_found')
   await invariant(a.projectId)
  })
  await t.test('former owner still a member is retained; unrelated ownership updates are no-ops',async()=>{
   const a=await fixture()
   await pool.query("INSERT INTO project_memberships(id,project_id,user_id,added_by,display_role) VALUES($1,$2,$3,$3,'Viewer')",[crypto.randomUUID(),a.projectId,ids.owner])
   const task=await tasks.update(a.task.id,ids.owner,{assigneeUserId:ids.owner})
   await pool.query('UPDATE source_projects SET owner_id=$2 WHERE id=$1',[a.projectId,ids.newowner])
   assert.deepEqual(await tasks.read(task.id,ids.newowner),task)
   await pool.query('UPDATE source_projects SET owner_id=owner_id WHERE id=$1',[a.projectId])
   assert.deepEqual(await tasks.read(task.id,ids.newowner),task)
  })
  await t.test('assignment and membership grant no owner-only task or sprint access',async()=>{
   const a=await fixture()
   assert.equal(await tasks.read(a.task.id,ids.member),null)
   for(const run of [
    ()=>tasks.list(ids.member,{projectId:a.projectId}),
    ()=>tasks.update(a.task.id,ids.member,{assigneeUserId:null}),
    ()=>tasks.remove(a.task.id,ids.member),
    ()=>sprints.read(a.sprint.id,ids.member),
    ()=>sprints.tasks(a.sprint.id,ids.member,{}),
    ()=>members.list(ids.member,{projectId:a.projectId}),
   ])await assert.rejects(run(),e=>e.code==='not_found')
   assert.deepEqual(await tasks.read(a.task.id,ids.owner),a.task)
  })
  await t.test('assignment races with API and direct removal converge or atomically roll back',async()=>{
   for(const direct of [false,true]){
    const a=await fixture()
    const outcomes=await Promise.allSettled([
     tasks.update(a.task.id,ids.owner,{assigneeUserId:ids.member}),
     direct?pool.query('DELETE FROM project_memberships WHERE id=$1',[a.member.id]):members.remove(a.member.id,ids.owner),
    ])
    for(const result of outcomes)if(result.status==='rejected')assert(['assignee_not_eligible','40P01','40001'].includes(result.reason.code))
    await invariant(a.projectId)
   }
  })
  await t.test('removal-first blocks assignment and rejects stale selection after commit',async()=>{
   const a=await fixture(),c=await pool.connect();let pending
   try{
    await c.query('BEGIN')
    const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await c.query('SELECT id FROM source_projects WHERE id=$1 FOR UPDATE',[a.projectId])
    await c.query('DELETE FROM project_memberships WHERE id=$1',[a.member.id])
    pending=tasks.update(a.task.id,ids.owner,{assigneeUserId:ids.member})
    // Attach rejection handler immediately; release the project lock before awaiting result.
    const result=pending.then(()=>null,e=>e)
    const deadline=Date.now()+3000;let blocked=false
    while(Date.now()<deadline){
     if((await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid))) AS blocked',[pid])).rows[0].blocked){blocked=true;break}
     await new Promise(resolve=>setTimeout(resolve,10))
    }
    assert.equal(blocked,true)
    await c.query('COMMIT')
    assert.equal((await result).code,'assignee_not_eligible')
    await invariant(a.projectId);await assertCleared(a.task)
   }finally{await c.query('ROLLBACK');if(pending)await pending.catch(()=>{});c.release()}
  })
  await t.test('assignment and sprint mutation race with ownership transfer without invalid commit',async()=>{
   const a=await fixture()
   const results=await Promise.allSettled([
    tasks.update(a.task.id,ids.owner,{assigneeUserId:ids.owner}),
    sprints.assign(a.sprint.id,a.task.id,ids.owner,true),
    pool.query('UPDATE source_projects SET owner_id=$2 WHERE id=$1',[a.projectId,ids.newowner]),
   ])
   for(const r of results)if(r.status==='rejected')assert(['not_found','40P01','40001'].includes(r.reason.code))
   await invariant(a.projectId)
   const saved=await tasks.read(a.task.id,ids.newowner)
   assert.equal(saved.title,a.task.title);assert.equal(saved.description,a.task.description)
   assert.equal(saved.status,a.task.status);assert.equal(saved.priority,a.task.priority)
  })
  await t.test('repeatable snapshots abort cleanup instead of risking an invisible stale assignment',async()=>{
   const a=await fixture(),c=await pool.connect()
   try{
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    await assert.rejects(c.query('DELETE FROM project_memberships WHERE id=$1',[a.member.id]),e=>e.code==='40001')
    await c.query('ROLLBACK')
    assert.deepEqual(await tasks.read(a.task.id,ids.owner),a.task)
   }finally{await c.query('ROLLBACK');c.release()}
  })
 }finally{
  if(pool)await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()
 }
})
