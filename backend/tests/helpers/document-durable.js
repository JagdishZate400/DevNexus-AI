// Offline SQL contract fixture only. This does not certify PostgreSQL locking.
const crypto=require('crypto')
const {createDocumentRepository}=require('../../src/db/documentRepository')
function durableFixture({requestsReady=true}={}) {
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),fileId=crypto.randomUUID()
 const files=[{fileId,path:'app.js',hash:'a'.repeat(64),byteSize:10}]
 const metadata=[]
 const state={documents:[],requests:[],clock:0,queries:[]};let tail=Promise.resolve()
 const rows=r=>({rows:r})
 async function query(sql,args=[]) {
  state.queries.push(sql)
  if(sql.startsWith('SET LOCAL')||sql.startsWith('SELECT pg_advisory'))return rows([])
  if(sql.includes('to_regclass'))return rows([{requests:requestsReady?'project_document_requests':null}])
  if(sql.startsWith('SELECT id FROM source_projects'))return rows(args[1]===owner && ['owned','second'].includes(args[0])?[{id:args[0]}]:[])
  if(sql.startsWith('SELECT project_id,document_type'))return rows(state.requests.filter(r=>r.owner_id===args[0]&&r.request_id===args[1]))
  if(sql.startsWith('INSERT INTO project_document_requests')) {state.requests.push({owner_id:args[0],request_id:args[1],project_id:args[2],document_type:args[3],document_id:args[4]});return rows([])}
  if(sql.startsWith('SELECT id FROM project_documents'))return rows(state.documents.filter(d=>d.projectId===args[0]&&['Pending','Running'].includes(d.generationStatus)).slice(0,1))
  if(sql.includes('FROM source_files'))return rows(args[0]==='owned'?files:[])
  if(sql.includes('FROM project_document_evidence'))return rows(args[0]==='owned'?metadata:[])
  if(sql.startsWith('INSERT INTO project_documents')) {
   const [id,projectId,creatorId,documentType,title,markdown,generationStatus,provider,model,refs,coverage]=args
   state.documents.push({id,projectId,creatorId,documentType,title,markdown,generationStatus,provider,model,sourceReferences:JSON.parse(refs),coverage:JSON.parse(coverage),updated:state.clock});return rows([])
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM project_documents'))return rows(state.documents.filter(d=>d.id===args[0]&&args[1]===owner).map(d=>({...structuredClone(d),generationLive:state.clock-d.updated<=600000})))
  if(sql.startsWith('UPDATE project_documents')) {
   if(sql.includes('RETURNING id')) {
    const expired=state.documents.filter(d=>d.projectId===args[0]&&['Pending','Running'].includes(d.generationStatus)&&state.clock-d.updated>600000)
    for(const d of expired){d.generationStatus='Failed';d.failureCode='worker_interrupted';d.updated=state.clock}
    return rows(expired.map(d=>({id:d.id})))
   }
   const d=state.documents.find(d=>d.id===args[0]);if(!d)throw Error('Missing fixture row')
   if(sql.includes("generation_status='Running'"))d.generationStatus='Running'
   if(sql.includes("generation_status='Completed'")){d.generationStatus='Completed';d.markdown=args[1];d.coverage=JSON.parse(args[2]);d.sourceReferences=JSON.parse(args[3])}
   if(sql.includes("generation_status='Failed'")){d.generationStatus='Failed';d.failureCode=args[1]}
   d.updated=state.clock;return rows([])
  }
  throw Error('Unhandled offline SQL contract')
 }
 const pool={query,async connect(){let release;const before=tail;tail=new Promise(r=>release=r);await before;let saved
  return {async query(sql,args){if(sql==='BEGIN'){saved=structuredClone({documents:state.documents,requests:state.requests});return rows([])}if(sql==='ROLLBACK'){state.documents=saved.documents;state.requests=saved.requests;return rows([])}if(sql==='COMMIT')return rows([]);return query(sql,args)},release(){release()}}
 }}
 return {owner,other,files,metadata,state,repo:createDocumentRepository(pool),input:(requestId)=>({projectId:'owned',documentType:'project-overview',title:'Overview',provider:'gemini',model:'fixture',fileIds:[fileId],...(requestId?{requestId}:{})})}
}
module.exports={durableFixture}
