const crypto=require('crypto')
const v=require('../services/taskCommentValidation')
const fields='id,task_id,author_user_id,author_display_name_snapshot,body,created_at,position::text AS position,client_request_id'
const missing=()=>v.error('not_found','Owned task not found.',404)
function canonical(row){return {id:row.id,taskId:row.task_id,author:{userId:row.author_user_id,displayName:row.author_display_name_snapshot},body:row.body,createdAt:new Date(row.created_at).toISOString(),position:row.position,clientRequestId:row.client_request_id}}
function createTaskCommentRepository(pool){
 async function transaction(run){
  const client=await pool.connect()
  try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='10000ms'");const result=await run(client);await client.query('COMMIT');return result}
  catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
 async function owned(client,taskId,userId,write){
  const task=(await client.query('SELECT project_id FROM project_tasks WHERE id=$1',[taskId])).rows[0]
  if(!task)throw missing()
  if(!(await client.query(`SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR ${write?'UPDATE':'SHARE'}`,[task.project_id,userId])).rows.length)throw missing()
  if(!(await client.query('SELECT id FROM project_tasks WHERE id=$1 AND project_id=$2 FOR SHARE',[taskId,task.project_id])).rows.length)throw missing()
 }
 return {
  async list(taskId,userId,query={}){
   taskId=v.uuid(taskId);userId=v.uuid(userId);const page=v.pagination(taskId,query)
   return transaction(async client=>{
    await owned(client,taskId,userId,false)
    const rows=(await client.query(`SELECT ${fields} FROM project_task_comments WHERE task_id=$1 AND ($2::bigint IS NULL OR position<$2) ORDER BY project_task_comments.position DESC LIMIT $3`,[taskId,page.before,page.limit+1])).rows
    const hasMore=rows.length>page.limit,comments=rows.slice(0,page.limit).map(canonical)
    return {taskId,comments,limit:page.limit,nextCursor:hasMore?v.cursor(taskId,comments.at(-1).position):null,hasMore}
   })
  },
  async create(taskId,userId,value){
   taskId=v.uuid(taskId);userId=v.uuid(userId);const input=v.input(value)
   return transaction(async client=>{
    // Reauthorize before any retry lookup. Serialize ownership transfer and same-project writes.
    await owned(client,taskId,userId,true)
    const author=(await client.query('SELECT id,full_name FROM users WHERE id=$1 FOR SHARE',[userId])).rows[0]
    if(!author)throw v.error('unauthorized','Invalid or expired token',401)
    const inserted=(await client.query(`INSERT INTO project_task_comments(id,task_id,author_user_id,author_display_name_snapshot,body,client_request_id)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (task_id,client_request_id) DO NOTHING RETURNING ${fields}`,[crypto.randomUUID(),taskId,author.id,author.full_name,input.body,input.clientRequestId])).rows[0]
    if(inserted)return {comment:canonical(inserted),created:true}
    // READ COMMITTED supplies a fresh statement snapshot after a concurrent conflict commits.
    const original=(await client.query(`SELECT ${fields} FROM project_task_comments WHERE task_id=$1 AND client_request_id=$2`,[taskId,input.clientRequestId])).rows[0]
    if(!original || original.author_user_id!==userId || original.body!==input.body)throw v.error('comment_request_conflict','Comment request ID was already used for another submission.',409)
    return {comment:canonical(original),created:false}
   })
  },
 }
}
module.exports={createTaskCommentRepository}
