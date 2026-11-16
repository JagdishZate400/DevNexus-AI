const crypto=require('crypto')
const v=require('../services/taskValidation')
const {withTaskActivity}=require('./taskActivityContext')
const {taskProjection}=require('./taskProjection')
const {teamReadAccess}=require('./teamReadAccess')
const columns=taskProjection()
const qualified=taskProjection('t')
const missing=()=>v.taskError('not_found','Owned task or project not found.',404)
function createTaskRepository(pool){
  async function transaction(run,snapshot=false){
    const client=await pool.connect()
    try{
      await client.query(snapshot==='current'?'BEGIN ISOLATION LEVEL READ COMMITTED':snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN')
      await client.query("SET LOCAL statement_timeout='10000ms'")
      const result=await run(client)
      await client.query('COMMIT')
      return result
    }catch(error){await client.query('ROLLBACK');throw error}
    finally{client.release()}
  }
  async function owned(client,projectId,ownerId,write=false){
    if(!(await client.query(`SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR ${write?'UPDATE':'SHARE'}`,[projectId,ownerId])).rows.length)throw missing()
  }
  async function lock(client,id,ownerId){
    // Discover without a row lock, then always lock project before task (as sprints do).
    const row=(await client.query('SELECT project_id AS "projectId" FROM project_tasks WHERE id=$1',[id])).rows[0]
    if(!row)throw missing()
    await owned(client,row.projectId,ownerId,true)
    if(!(await client.query('SELECT id FROM project_tasks WHERE id=$1 AND project_id=$2 FOR UPDATE',[id,row.projectId])).rows.length)throw missing()
    return row.projectId
  }
  async function assignee(client,projectId,ownerId,userId){
    if(userId==null)return
    const rejected=()=>v.taskError('assignee_not_eligible','Selected assignee is unavailable for this project.',400)
    // Project UPDATE serializes lifecycle changes. Membership SHARE protects eligibility.
    // Lock order: project -> task (when present) -> membership -> registered user.
    if(userId!==ownerId.toLowerCase() && !(await client.query(
      'SELECT id FROM project_memberships WHERE project_id=$1 AND user_id=$2 FOR SHARE',[projectId,userId])).rows.length)throw rejected()
    if(!(await client.query('SELECT id FROM users WHERE id=$1 FOR KEY SHARE',[userId])).rows.length)throw rejected()
  }
  return {
    async visible(userId,input){
      const {projectId,limit,offset}=v.pagination(input)
      return transaction(async client=>{
        await teamReadAccess(client,projectId,userId,()=>v.taskError('not_found','Project or membership not found.',404))
        const total=Number((await client.query('SELECT count(*) AS total FROM project_tasks WHERE project_id=$1',[projectId])).rows[0].total)
        const tasks=(await client.query(`SELECT ${qualified} FROM project_tasks t WHERE t.project_id=$1 ORDER BY t.created_at DESC,t.id DESC LIMIT $2 OFFSET $3`,[projectId,limit,offset])).rows
        return {tasks,total,limit,offset}
      },'current')
    },
    async create(input,ownerId){
      input=v.taskInput(input)
      return transaction(async client=>{
        await owned(client,input.projectId,ownerId,true)
        await assignee(client,input.projectId,ownerId,input.assigneeUserId)
        return withTaskActivity(client,{actorUserId:ownerId,projectId:input.projectId,reason:'task_created'},async()=>
         (await client.query(`INSERT INTO project_tasks(id,project_id,creator_id,title,description,status,priority,assignee_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${columns}`,[crypto.randomUUID(),input.projectId,ownerId,input.title,input.description,input.status,input.priority,input.assigneeUserId??null])).rows[0])
      })
    },
    async list(ownerId,input){
      const {projectId,limit,offset}=v.pagination(input)
      return transaction(async client=>{
        await owned(client,projectId,ownerId)
        const total=Number((await client.query('SELECT count(*) AS total FROM project_tasks WHERE project_id=$1',[projectId])).rows[0].total)
        const tasks=(await client.query(`SELECT ${qualified} FROM project_tasks t JOIN source_projects p ON p.id=t.project_id
          WHERE t.project_id=$1 AND p.owner_id=$2 ORDER BY t.created_at DESC,t.id DESC LIMIT $3 OFFSET $4`,[projectId,ownerId,limit,offset])).rows
        return {tasks,total,limit,offset}
      },true)
    },
    async read(id,ownerId){
      v.uuid(id)
      return (await pool.query(`SELECT ${qualified} FROM project_tasks t JOIN source_projects p ON p.id=t.project_id WHERE t.id=$1 AND p.owner_id=$2`,[id,ownerId])).rows[0] || null
    },
    async update(id,ownerId,input){
      v.uuid(id);input=v.taskInput(input,true)
      return transaction(async client=>{
        const projectId=await lock(client,id,ownerId)
        const assignmentChanged=Object.hasOwn(input,'assigneeUserId')
        if(assignmentChanged)await assignee(client,projectId,ownerId,input.assigneeUserId)
        return withTaskActivity(client,{actorUserId:ownerId,projectId,reason:'task_updated'},async()=>
         (await client.query(`UPDATE project_tasks SET title=COALESCE($2,title),description=COALESCE($3,description),status=COALESCE($4,status),priority=COALESCE($5,priority),
          assignee_user_id=CASE WHEN $6::boolean THEN $7::uuid ELSE assignee_user_id END,updated_at=now()
          WHERE id=$1 RETURNING ${columns}`,[id,input.title??null,input.description??null,input.status??null,input.priority??null,assignmentChanged,input.assigneeUserId??null])).rows[0])
      })
    },
    async remove(id,ownerId){
      v.uuid(id)
      await transaction(async client=>{await lock(client,id,ownerId);await client.query('DELETE FROM project_tasks WHERE id=$1',[id])})
    },
  }
}
module.exports={createTaskRepository}
