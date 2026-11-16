const {error}=require('../services/reportValidation')
const SEVERITIES=Object.freeze(['Critical','High','Medium','Low','Info'])
function count(value){
 const n=Number(value)
 if(value===null||value===undefined||!Number.isSafeInteger(n)||n<0)throw Error('Invalid reporting count')
 return n
}
function completion(done,total){return total?Math.round(done/total*10000)/100:null}
function statusCounts(rows){return rows.map(row=>({status:row.status,count:count(row.count)}))}
function sum(rows){return rows.reduce((total,row)=>count(total+count(row.count)),0)}
function tasks(row){
 const result=Object.fromEntries(['total','toDo','inProgress','done'].map(key=>[key,count(row[key])]))
 if(result.total!==result.toDo+result.inProgress+result.done)throw Error('Unsupported task status')
 return {...result,completionPercent:completion(result.done,result.total)}
}
const TASK_COUNTS=`count(*) AS total,count(*) FILTER(WHERE status='To Do') AS "toDo",
 count(*) FILTER(WHERE status='In Progress') AS "inProgress",count(*) FILTER(WHERE status='Done') AS done`
function createReportsRepository(pool){
 async function snapshot(run){
  const client=await pool.connect()
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
   await client.query("SET LOCAL statement_timeout='10000ms'")
   const value=await run(client);await client.query('COMMIT');return value
  }catch(err){await client.query('ROLLBACK');throw err}finally{client.release()}
 }
 return {
  async projects(ownerId){
   return {projects:(await pool.query('SELECT id,name FROM source_projects WHERE owner_id=$1 ORDER BY name,id',[ownerId])).rows}
  },
  async project(ownerId,projectId){
   return snapshot(async client=>{
    const project=(await client.query('SELECT id,name,transaction_timestamp() AS "asOf" FROM source_projects WHERE id=$1 AND owner_id=$2',[projectId,ownerId])).rows[0]
    if(!project)throw error('not_found','Owned project not found.',404)
    const task=tasks((await client.query(`SELECT ${TASK_COUNTS} FROM project_tasks WHERE project_id=$1`,[projectId])).rows[0])
    const sprints=(await client.query(`SELECT s.id,s.name,s.status,count(t.id) AS total,
     count(t.id) FILTER(WHERE t.status='Done') AS done FROM project_sprints s
     LEFT JOIN project_tasks t ON t.sprint_id=s.id AND t.project_id=s.project_id
     WHERE s.project_id=$1 GROUP BY s.id ORDER BY s.created_at DESC,s.id DESC`,[projectId])).rows.map(row=>{
      const total=count(row.total),done=count(row.done)
      if(done>total)throw Error('Invalid sprint counts')
      return {id:row.id,name:row.name,status:row.status,total,done,completionPercent:completion(done,total)}
     })
    // File records include batch children once each. Never join them to manifests
    // for aggregation: retries or multiple references must not multiply findings.
    const fileRows=(await client.query('SELECT status,count(*) AS count FROM repository_reviews WHERE project_id=$1 GROUP BY status ORDER BY status',[projectId])).rows
    // Match the existing batch-history boundary: current project and batch owner.
    const batchRows=(await client.query('SELECT status,count(*) AS count FROM repository_review_batches WHERE project_id=$1 AND owner_id=$2 GROUP BY status ORDER BY status',[projectId,ownerId])).rows
    const findingRows=(await client.query(`SELECT f.severity,count(*) AS count FROM repository_review_findings f
     JOIN repository_reviews r ON r.id=f.review_id WHERE r.project_id=$1 AND r.status='Completed'
     GROUP BY f.severity ORDER BY f.severity NULLS LAST`,[projectId])).rows
    const bySeverity=SEVERITIES.map(severity=>({severity,count:0,classification:'current'}))
    for(const row of findingRows){
     const known=bySeverity.find(item=>item.severity===row.severity)
     if(known)known.count=count(row.count)
     else bySeverity.push({severity:row.severity,count:count(row.count),classification:'historical'})
    }
    return {project:{id:project.id,name:project.name},asOf:new Date(project.asOf).toISOString(),tasks:task,sprints,
     reviews:{fileReviews:{total:sum(fileRows),byStatus:statusCounts(fileRows)},batches:{total:sum(batchRows),byStatus:statusCounts(batchRows)},
      findings:{total:sum(findingRows),bySeverity}}}
   })
  },
  // Dashboard says "reviews completed" and "documents generated": total means
  // Completed in this compatibility response; savedTotal includes all file records.
  async summary(ownerId){
   return snapshot(async client=>{
    const scope='SELECT id FROM source_projects WHERE owner_id=$1'
    const asOf=(await client.query('SELECT transaction_timestamp() AS "asOf"')).rows[0].asOf
    const projects=count((await client.query('SELECT count(*) AS total FROM source_projects WHERE owner_id=$1',[ownerId])).rows[0].total)
    const taskRows=(await client.query(`SELECT status,priority,count(*) AS count FROM project_tasks WHERE project_id IN (${scope}) GROUP BY status,priority`,[ownerId])).rows
    const sprintRows=(await client.query(`SELECT status,count(*) AS count FROM project_sprints WHERE project_id IN (${scope}) GROUP BY status`,[ownerId])).rows
    const reviewRows=(await client.query(`SELECT status,count(*) AS count FROM repository_reviews WHERE project_id IN (${scope}) GROUP BY status`,[ownerId])).rows
    const docs=(await client.query(`SELECT document_type AS type,count(*) AS count FROM project_documents WHERE project_id IN (${scope}) AND generation_status='Completed' GROUP BY document_type`,[ownerId])).rows
    const team=count((await client.query(`SELECT count(DISTINCT m.user_id) AS total FROM project_memberships m JOIN source_projects p ON p.id=m.project_id WHERE p.owner_id=$1 AND m.user_id<>p.owner_id`,[ownerId])).rows[0].total)
    const security=count((await client.query(`SELECT count(*) AS total FROM repository_review_findings f JOIN repository_reviews r ON r.id=f.review_id JOIN source_projects p ON p.id=r.project_id WHERE p.owner_id=$1 AND r.status='Completed' AND f.finding_type='Security'`,[ownerId])).rows[0].total)
    const group=(rows,key)=>{const result=Object.create(null);for(const row of rows)result[row[key]]=count((result[row[key]]||0)+count(row.count));return result}
    return {generatedAt:new Date(asOf).toISOString(),projects:{total:projects,byStatus:projects?{Unknown:projects}:{}},
     tasks:{total:sum(taskRows),byStatus:group(taskRows,'status'),byPriority:group(taskRows,'priority')},
     sprints:{total:sum(sprintRows),byStatus:group(sprintRows,'status')},team:{total:team},
     reviews:{total:sum(reviewRows.filter(row=>row.status==='Completed')),savedTotal:sum(reviewRows)},
     documents:{total:sum(docs),byType:group(docs,'type')},security:{total:security}}
   })
  },
 }
}
module.exports={createReportsRepository,completion}
