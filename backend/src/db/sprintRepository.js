const crypto=require('crypto')
const v=require('../services/sprintValidation')
const {withTaskActivity}=require('./taskActivityContext')
const {taskProjection}=require('./taskProjection')
const columns='id,project_id AS "projectId",creator_id AS "creatorId",name,goal,start_date::text AS "startDate",end_date::text AS "endDate",status,created_at AS "createdAt",updated_at AS "updatedAt"'
const missing=()=>v.error('not_found','Owned sprint, task or project not found.',404)
function summary(row){
 const {toDo,inProgress,done,total,...sprint}=row
 const counts={toDo:Number(toDo),inProgress:Number(inProgress),done:Number(done),total:Number(total)}
 return {...sprint,counts,progress:counts.total?Math.round(counts.done/counts.total*10000)/100:null,empty:counts.total===0}
}
function createSprintRepository(pool){
 async function transaction(run,snapshot=false){
  const client=await pool.connect()
  try{
   await client.query(snapshot?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN')
   await client.query("SET LOCAL statement_timeout='10000ms'")
   const result=await run(client);await client.query('COMMIT');return result
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
 async function owned(client,projectId,ownerId,write=false){
  if(!(await client.query(`SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR ${write?'UPDATE':'SHARE'}`,[projectId,ownerId])).rows.length)throw missing()
 }
 async function authorized(client,id,ownerId){
  const row=(await client.query('SELECT project_id AS "projectId" FROM project_sprints WHERE id=$1',[id])).rows[0]
  if(!row)throw missing()
  await owned(client,row.projectId,ownerId,true)
  const sprint=(await client.query(`SELECT ${columns} FROM project_sprints WHERE id=$1 FOR UPDATE`,[id])).rows[0]
  if(!sprint)throw missing()
  return sprint
 }
 async function readSummary(client,id){
  return summary((await client.query(`SELECT ${columns},
   (SELECT count(*) FROM project_tasks t WHERE t.sprint_id=s.id AND t.project_id=s.project_id AND t.status='To Do') AS "toDo",
   (SELECT count(*) FROM project_tasks t WHERE t.sprint_id=s.id AND t.project_id=s.project_id AND t.status='In Progress') AS "inProgress",
   (SELECT count(*) FROM project_tasks t WHERE t.sprint_id=s.id AND t.project_id=s.project_id AND t.status='Done') AS done,
   (SELECT count(*) FROM project_tasks t WHERE t.sprint_id=s.id AND t.project_id=s.project_id) AS total
   FROM project_sprints s WHERE s.id=$1`,[id])).rows[0])
 }
 return {
  async create(input,ownerId){
   input=v.input(input)
   return transaction(async client=>{
    await owned(client,input.projectId,ownerId,true)
    const id=crypto.randomUUID()
    await client.query(`INSERT INTO project_sprints(id,project_id,creator_id,name,goal,start_date,end_date,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,input.projectId,ownerId,input.name,input.goal,input.startDate,input.endDate,input.status])
    return readSummary(client,id)
   })
  },
  async list(ownerId,input){
   const {projectId,limit,offset}=v.page(input)
   return transaction(async client=>{
    await owned(client,projectId,ownerId)
    const total=Number((await client.query('SELECT count(*) AS total FROM project_sprints WHERE project_id=$1',[projectId])).rows[0].total)
    const rows=(await client.query('SELECT id FROM project_sprints WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',[projectId,limit,offset])).rows
    const sprints=[]
    for(const row of rows)sprints.push(await readSummary(client,row.id))
    return {sprints,total,limit,offset}
   },true)
  },
  async read(id,ownerId){v.uuid(id);return transaction(async client=>{await authorized(client,id,ownerId);return readSummary(client,id)},true)},
  async update(id,ownerId,input){
   v.uuid(id);input=v.input(input,true)
   return transaction(async client=>{
    const previous=await authorized(client,id,ownerId)
    if((input.endDate??previous.endDate)<(input.startDate??previous.startDate))throw v.invalid()
    await client.query(`UPDATE project_sprints SET name=COALESCE($2,name),goal=COALESCE($3,goal),start_date=COALESCE($4::date,start_date),end_date=COALESCE($5::date,end_date),status=COALESCE($6,status),updated_at=now() WHERE id=$1`,[id,input.name??null,input.goal??null,input.startDate??null,input.endDate??null,input.status??null])
    return readSummary(client,id)
   })
  },
  async tasks(id,ownerId,input){
   v.uuid(id);const {limit,offset}=v.page(input,false)
   return transaction(async client=>{
    const sprint=await authorized(client,id,ownerId),details=await readSummary(client,id)
    const tasks=(await client.query(`SELECT ${taskProjection()} FROM project_tasks WHERE sprint_id=$1 AND project_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,[id,sprint.projectId,limit,offset])).rows
    return {tasks,total:details.counts.total,limit,offset}
   },true)
  },
  async assign(id,taskId,ownerId,remove=false){
   v.uuid(id);v.uuid(taskId)
   return transaction(async client=>{
    const sprint=await authorized(client,id,ownerId)
    const task=(await client.query('SELECT id,sprint_id AS "sprintId" FROM project_tasks WHERE id=$1 AND project_id=$2 FOR UPDATE',[taskId,sprint.projectId])).rows[0]
    if(!task)throw missing()
    if(task.sprintId && task.sprintId!==id)throw v.error('task_already_assigned','Task belongs to another sprint. Remove its assignment first.',409)
    if(remove && task.sprintId!==id)throw missing()
    if(remove || task.sprintId!==id)await withTaskActivity(client,{actorUserId:ownerId,projectId:sprint.projectId,reason:'sprint_link_changed'},()=>
     client.query('UPDATE project_tasks SET sprint_id=$2,updated_at=now() WHERE id=$1',[taskId,remove?null:id]))
    return readSummary(client,id)
   })
  },
 }
}
module.exports={createSprintRepository,summary}
