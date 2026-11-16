const v=require('../services/taskActivityValidation')
function canonical(row,taskId){return v.record({id:row.id,taskId:row.task_id,actor:row.actor_display_name_snapshot===null&&row.actor_user_id===null?null:{userId:row.actor_user_id,displayName:row.actor_display_name_snapshot},eventType:row.event_type,origin:row.origin,reason:row.reason,changes:row.changes,occurredAt:new Date(row.occurred_at).toISOString(),correlationId:row.correlation_id},taskId)}
function createTaskActivityRepository(pool){return {
 async list(taskId,userId,query={}){
  taskId=v.uuid(taskId);userId=v.uuid(userId);const page=v.pagination(taskId,query),client=await pool.connect()
  const missing=()=>v.error('not_found','Owned task not found.',404)
  try{
   await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='10000ms'")
   const task=(await client.query('SELECT project_id FROM project_tasks WHERE id=$1',[taskId])).rows[0];if(!task)throw missing()
   if(!(await client.query('SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR SHARE',[task.project_id,userId])).rows.length)throw missing()
   if(!(await client.query('SELECT id FROM project_tasks WHERE id=$1 AND project_id=$2 FOR SHARE',[taskId,task.project_id])).rows.length)throw missing()
   const rows=(await client.query('SELECT a.id::text AS id,a.task_id,a.actor_user_id,a.actor_display_name_snapshot,a.event_type,a.origin,a.reason,a.changes,a.occurred_at,a.correlation_id FROM project_task_activity a WHERE a.task_id=$1 AND ($2::bigint IS NULL OR a.id<$2) ORDER BY a.id DESC LIMIT $3',[taskId,page.before,page.limit+1])).rows
   const activity=rows.slice(0,page.limit).map(row=>canonical(row,taskId)),hasMore=rows.length>page.limit
   const result=v.page({taskId,activity,limit:page.limit,nextCursor:hasMore?v.cursor(taskId,activity.at(-1).id):null,hasMore},taskId,page.limit)
   await client.query('COMMIT');return result
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 },
}}
module.exports={createTaskActivityRepository}
