const crypto=require('crypto')
const v=require('../services/membershipValidation')
const {withTaskActivity}=require('./taskActivityContext')
const {teamReadAccess}=require('./teamReadAccess')
const columns='m.id,m.project_id AS "projectId",m.user_id AS "userId",u.full_name AS "displayName",u.email,m.display_role AS "displayRole",m.created_at AS "createdAt",m.updated_at AS "updatedAt"'
const missing=()=>v.error('not_found','Owned project or membership not found.',404)
function createMembershipRepository(pool){
 async function transaction(run,snapshot=false){
  const client=await pool.connect()
  try{
   await client.query(snapshot==='current'?'BEGIN ISOLATION LEVEL READ COMMITTED':snapshot?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN')
   await client.query("SET LOCAL statement_timeout='10000ms'")
   const result=await run(client);await client.query('COMMIT');return result
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
 async function owned(client,projectId,ownerId,write=false){
  if(!(await client.query(`SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR ${write?'UPDATE':'SHARE'}`,[projectId,ownerId])).rows.length)throw missing()
 }
 async function lock(client,id,ownerId){
  const row=(await client.query('SELECT project_id AS "projectId" FROM project_memberships WHERE id=$1',[id])).rows[0]
  if(!row)throw missing()
  await owned(client,row.projectId,ownerId,true)
  const member=(await client.query('SELECT id,user_id AS "userId" FROM project_memberships WHERE id=$1 AND user_id<>$2 FOR UPDATE',[id,ownerId])).rows[0]
  if(!member)throw missing()
  return {...member,projectId:row.projectId}
 }
 async function read(client,id){
  return (await client.query(`SELECT ${columns} FROM project_memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$1`,[id])).rows[0]
 }
 return {
  async projects(userId){
   return {projects:(await pool.query(`SELECT p.id,p.name,p.owner_id AS "ownerId",
    CASE WHEN p.owner_id=$1 THEN 'owner' ELSE 'member' END AS access
    FROM source_projects p WHERE p.owner_id=$1 OR EXISTS
    (SELECT 1 FROM project_memberships m WHERE m.project_id=p.id AND m.user_id=$1)
    ORDER BY p.name,p.id`,[userId])).rows}
  },
  async directory(userId,input){
   const {projectId,limit,offset}=v.pagination(input)
   return transaction(async client=>{
    const {ownerId}=await teamReadAccess(client,projectId,userId,()=>v.error('not_found','Project or membership not found.',404))
    const owner=(await client.query('SELECT id AS "userId",full_name AS "displayName",email FROM users WHERE id=$1',[ownerId])).rows[0]
    const total=Number((await client.query('SELECT count(*) AS total FROM project_memberships WHERE project_id=$1 AND user_id<>$2',[projectId,ownerId])).rows[0].total)
    const members=(await client.query(`SELECT ${columns} FROM project_memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 AND m.user_id<>$2 ORDER BY m.created_at DESC,m.id DESC LIMIT $3 OFFSET $4`,[projectId,ownerId,limit,offset])).rows
    return {projectId,owner,members,total,limit,offset}
   },'current')
  },
  async list(ownerId,input){
   const {projectId,limit,offset}=v.pagination(input)
   return transaction(async client=>{
    await owned(client,projectId,ownerId)
    const owner=(await client.query('SELECT id AS "userId",full_name AS "displayName",email FROM users WHERE id=$1',[ownerId])).rows[0]
    const total=Number((await client.query('SELECT count(*) AS total FROM project_memberships WHERE project_id=$1 AND user_id<>$2',[projectId,ownerId])).rows[0].total)
    const members=(await client.query(`SELECT ${columns} FROM project_memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 AND m.user_id<>$2 ORDER BY m.created_at DESC,m.id DESC LIMIT $3 OFFSET $4`,[projectId,ownerId,limit,offset])).rows
    return {projectId,owner,members,total,limit,offset}
   },true)
  },
  async create(input,ownerId){
   input=v.input(input)
   return transaction(async client=>{
    await owned(client,input.projectId,ownerId,true)
    // Exact email equality ignoring case; never search or enumerate the directory.
    const user=(await client.query('SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1 FOR KEY SHARE',[input.email])).rows[0]
    if(!user || user.id===ownerId)throw v.notAdded()
    const id=crypto.randomUUID()
    const inserted=await client.query(`INSERT INTO project_memberships(id,project_id,user_id,added_by,display_role) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (project_id,user_id) DO NOTHING RETURNING id`,[id,input.projectId,user.id,ownerId,input.displayRole])
    if(!inserted.rows.length)throw v.notAdded()
    return read(client,id)
   })
  },
  async update(id,ownerId,input){
   v.uuid(id);input=v.input(input,true)
   return transaction(async client=>{
    await lock(client,id,ownerId)
    await client.query('UPDATE project_memberships SET display_role=$2,updated_at=now() WHERE id=$1',[id,input.displayRole])
    return read(client,id)
   })
  },
  async remove(id,ownerId){
   v.uuid(id)
   await transaction(async client=>{
    const member=await lock(client,id,ownerId)
    // Same transaction and project write lock as the deletion. Trigger cleanup is idempotent.
    await withTaskActivity(client,{actorUserId:ownerId,projectId:member.projectId,reason:'membership_removed'},async()=>{
     await client.query(`UPDATE project_tasks SET assignee_user_id=NULL,updated_at=now()
      WHERE project_id=$1 AND assignee_user_id=$2`,[member.projectId,member.userId])
     await client.query('DELETE FROM project_memberships WHERE id=$1',[id])
    })
   })
  },
 }
}
module.exports={createMembershipRepository}
