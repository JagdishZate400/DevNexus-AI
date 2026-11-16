require('./helpers/offline')
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto'),fs=require('fs'),path=require('path')
const {Client,Pool}=require('pg')
const {createDocumentRepository}=require('../src/db/documentRepository')
const {createDocumentEvidenceRepository}=require('../src/db/documentEvidenceRepository')
const approved=process.env.DOCUMENT_D3A_APPROVED==='yes' && !!process.env.DOCUMENT_D3A_DATABASE_URL
test('D3A real PostgreSQL migration, concurrent keys, evidence and recovery on verified empty disposable target',{skip:!approved},async()=>{
 const url=new URL(process.env.DOCUMENT_D3A_DATABASE_URL)
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname))
 assert.ok(/^\/devnexus_d3a_test_[a-z0-9]{8,}$/.test(url.pathname))
 assert.ok(url.port && !['5432','55451','55452','55454'].includes(url.port))
 const probe=new Client({connectionString:url.href,connectionTimeoutMillis:3000,options:'-c default_transaction_read_only=on -c statement_timeout=5000'})
 try {
  await probe.connect()
  const identity=(await probe.query('SELECT current_database() AS db,current_user AS role,pg_is_in_recovery() AS replica')).rows[0]
  assert.equal(identity.db,url.pathname.slice(1));assert.equal(identity.role,decodeURIComponent(url.username));assert.equal(identity.replica,false)
  assert.equal((await probe.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0,'Target must be empty and disposable')
  assert.equal((await probe.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper,false)
 } finally {await probe.end()}
 const pool=new Pool({connectionString:url.href,max:4,connectionTimeoutMillis:3000,options:'-c search_path=public -c statement_timeout=10000'})
 try {
  await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)')
  for(const name of ['0132-source-workspace.sql','0145-project-documents.sql','0157-documentation-evidence-requests.sql']) await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/migrations',name),'utf8'))
  const owner=crypto.randomUUID(),other=crypto.randomUUID(),fid=crypto.randomUUID(),content='export const value=1;',hash=crypto.createHash('sha256').update(content).digest('hex')
  await pool.query('INSERT INTO users(id) VALUES($1),($2)',[owner,other])
  await pool.query("INSERT INTO source_projects(id,owner_id,name) VALUES('owned',$1,'Synthetic D3A')",[owner])
  await pool.query("INSERT INTO source_files(id,project_id,path,language,content,byte_size,sha256) VALUES($1,'owned','app.js','JavaScript',$2,$3,$4)",[fid,content,Buffer.byteLength(content),hash])
  const repo=createDocumentRepository(pool),input={projectId:'owned',documentType:'project-overview',title:'Fixture',provider:'gemini',model:'fixture',fileIds:[fid],requestId:crypto.randomUUID()}
  const results=await Promise.all([repo.prepareGeneration(input,owner),repo.prepareGeneration(input,owner)])
  assert.equal(results[0].id,results[1].id)
  await assert.rejects(repo.prepareGeneration({...input,requestId:crypto.randomUUID()},owner),{code:'document_generation_active'})
  await assert.rejects(repo.replayGeneration(input,other),{code:'not_found'})
  await repo.startGeneration(results[0].id,owner)
  await pool.query("UPDATE project_documents SET updated_at=now()-interval '11 minutes' WHERE id=$1",[results[0].id])
  assert.deepEqual(await repo.recoverAbandoned('owned',owner),{recovered:1})
  assert.equal((await repo.replayGeneration(input,owner)).failureCode,'worker_interrupted')
  await assert.rejects(repo.completeGeneration(results[0].id,owner,'# Late',{filesSubmitted:1,filesIncluded:1,filesSkipped:0,filesFailed:0,truncated:false}),{code:'document_state_conflict'})
  const evidence=createDocumentEvidenceRepository(pool)
  await evidence.add('owned',owner,[{path:'.env.example',content:'PORT=5000'}])
  assert.deepEqual((await evidence.evidence('owned',owner)).files.find(f=>f.kind==='configuration-example').keys,['PORT'])
  await assert.rejects(evidence.evidence('owned',other),{code:'not_found'})
  // Retain the synthetic target for inspection. No containers/volumes are touched.
 } finally {await pool.end()}
})
