const {createReportsRepository}=require('../../src/db/reportsRepository')
// Offline SQL-contract fixture. No pg import, database URL, migration or provider.
function reportsFixture(owner='owner',other='other'){
 const state={projects:[{id:'alpha',name:'Alpha',ownerId:owner},{id:'empty',name:'Empty',ownerId:owner},{id:'foreign',name:'Foreign',ownerId:other}],
  tasks:Array.from({length:150},(_,i)=>({projectId:'alpha',status:i<70?'Done':i<120?'To Do':'In Progress',priority:i%2?'High':'Low',sprintId:i<90?'sprint-one':null})),
  sprints:[{id:'sprint-one',projectId:'alpha',name:'Delivery',status:'Active'},{id:'sprint-empty',projectId:'alpha',name:'Empty sprint',status:'Planning'}],
  reviews:[...['Completed','Completed','Completed','Failed','In Progress'].map((status,i)=>({id:`r${i}`,projectId:'alpha',status})),{id:'foreign-review',projectId:'foreign',status:'Completed'}],
  batches:[{projectId:'alpha',ownerId:owner,status:'Completed'},{projectId:'alpha',ownerId:owner,status:'Partial'},{projectId:'alpha',ownerId:other,status:'Failed'}],
  // A child can be referenced more than once. Aggregates must never join this list.
  batchFiles:[{reviewId:'r1'},{reviewId:'r2'},{reviewId:'r1'}],
  findings:[{reviewId:'r0',severity:'High',findingType:'Security'},{reviewId:'r0',severity:'High',findingType:'Bug'},{reviewId:'r1',severity:'Medium',findingType:'Security'},{reviewId:'r2',severity:'Legacy',findingType:null},{reviewId:'r3',severity:'Critical',findingType:'Security'},{reviewId:'foreign-review',severity:'Critical',findingType:'Security'}],
  docs:[{projectId:'alpha',status:'Completed',type:'project-overview'},{projectId:'alpha',status:'Draft',type:'readme'},{projectId:'foreign',status:'Completed',type:'readme'}],
  members:[{projectId:'alpha',userId:'member'},{projectId:'empty',userId:'member'}],calls:[],missing:null,released:0,
 }
 const asOf='2026-10-26T10:00:00.000Z'
 const result=rows=>({rows:structuredClone(rows)})
 const group=(rows,key)=>[...new Set(rows.map(row=>row[key]))].map(value=>({[key]:value,count:String(rows.filter(row=>row[key]===value).length)}))
 const pool={async connect(){return {query:pool.query,release(){state.released++}}},async query(sql,args=[]){
  state.calls.push({sql,args})
  if(state.missing&&sql.includes(state.missing))throw Object.assign(Error('private SQL schema detail'),{code:'42P01'})
  if(/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql))return result([])
  if(sql.startsWith('SELECT transaction_timestamp()'))return result([{asOf}])
  if(sql.startsWith('SELECT id,name,transaction_timestamp()'))return result(state.projects.filter(p=>p.id===args[0]&&p.ownerId===args[1]).map(p=>({id:p.id,name:p.name,asOf})))
  if(sql.startsWith('SELECT id,name FROM source_projects'))return result(state.projects.filter(p=>p.ownerId===args[0]).map(({id,name})=>({id,name})))
  if(sql.startsWith('SELECT count(*) AS total FROM source_projects'))return result([{total:String(state.projects.filter(p=>p.ownerId===args[0]).length)}])
  const ownerScope=sql.includes('project_id IN (SELECT id FROM source_projects')
  const projectIds=ownerScope?state.projects.filter(p=>p.ownerId===args[0]).map(p=>p.id):[args[0]]
  const scoped=rows=>rows.filter(row=>projectIds.includes(row.projectId))
  if(sql.startsWith('SELECT count(*) AS total,count(*)')){
   const rows=scoped(state.tasks)
   return result([{total:String(rows.length),toDo:String(rows.filter(t=>t.status==='To Do').length),inProgress:String(rows.filter(t=>t.status==='In Progress').length),done:String(rows.filter(t=>t.status==='Done').length)}])
  }
  if(sql.startsWith('SELECT s.id,s.name'))return result(scoped(state.sprints).map(s=>{
   const rows=state.tasks.filter(t=>t.sprintId===s.id&&t.projectId===s.projectId)
   return {id:s.id,name:s.name,status:s.status,total:String(rows.length),done:String(rows.filter(t=>t.status==='Done').length)}
  }))
  if(sql.startsWith('SELECT status,count(*)')&&sql.includes('FROM repository_reviews'))return result(group(scoped(state.reviews),'status'))
  if(sql.startsWith('SELECT status,count(*)')&&sql.includes('FROM repository_review_batches'))return result(group(scoped(state.batches).filter(b=>b.ownerId===args[1]),'status'))
  if(sql.startsWith('SELECT f.severity'))return result(group(state.findings.filter(f=>state.reviews.some(r=>r.id===f.reviewId&&r.projectId===args[0]&&r.status==='Completed')),'severity'))
  if(sql.startsWith('SELECT status,priority')){
   const rows=scoped(state.tasks),keys=[...new Set(rows.map(t=>`${t.status}|${t.priority}`))]
   return result(keys.map(key=>{const [status,priority]=key.split('|');return {status,priority,count:String(rows.filter(t=>t.status===status&&t.priority===priority).length)}}))
  }
  if(sql.startsWith('SELECT status,count(*)')&&sql.includes('FROM project_sprints'))return result(group(scoped(state.sprints),'status'))
  if(sql.startsWith('SELECT document_type'))return result(group(scoped(state.docs).filter(d=>d.status==='Completed'),'type'))
  if(sql.startsWith('SELECT count(DISTINCT m.user_id)')){
   const owned=state.projects.filter(p=>p.ownerId===args[0]).map(p=>p.id)
   return result([{total:String(new Set(state.members.filter(m=>owned.includes(m.projectId)&&m.userId!==args[0]).map(m=>m.userId)).size)}])
  }
  if(sql.startsWith('SELECT count(*) AS total FROM repository_review_findings')){
   const owned=state.projects.filter(p=>p.ownerId===args[0]).map(p=>p.id)
   return result([{total:String(state.findings.filter(f=>f.findingType==='Security'&&state.reviews.some(r=>r.id===f.reviewId&&owned.includes(r.projectId)&&r.status==='Completed')).length)}])
  }
  throw Error('Unexpected offline reporting SQL: '+sql)
 }}
 return {state,pool,repo:createReportsRepository(pool),asOf}
}
module.exports={reportsFixture}
