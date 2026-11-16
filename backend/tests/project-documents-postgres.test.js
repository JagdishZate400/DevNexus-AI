require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const fs=require('fs')
const path=require('path')
const {Pool}=require('pg')
const {createDocumentRepository}=require('../src/db/documentRepository')
// Opt-in ONLY: caller must supply a separate disposable database; never uses DATABASE_URL.
test('isolated PostgreSQL document migration, durable CRUD, generation and ownership',{skip:!process.env.DOCUMENT_TEST_DATABASE_URL},async()=>{
  const schema=`document_test_${crypto.randomBytes(8).toString('hex')}`
  const connectionString=process.env.DOCUMENT_TEST_DATABASE_URL
  const admin=new Pool({connectionString,connectionTimeoutMillis:5000})
  let pool,restarted
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    const options={connectionString,options:`-c search_path=${schema}`,connectionTimeoutMillis:5000}
    pool=new Pool(options)
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)')
    for(const name of ['0132-source-workspace.sql','0145-project-documents.sql']) await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/migrations',name),'utf8'))
    const owner=crypto.randomUUID(),other=crypto.randomUUID(),fileId=crypto.randomUUID(),hash=crypto.createHash('sha256').update('const x=1').digest('hex')
    await pool.query('INSERT INTO users(id) VALUES($1),($2)',[owner,other])
    await pool.query('INSERT INTO source_projects(id,owner_id,name) VALUES($1,$2,$3)',['owned',owner,'Test'])
    await pool.query('INSERT INTO source_files(id,project_id,path,language,content,byte_size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[fileId,'owned','app.js','JavaScript','const x=1',9,hash])
    let repo=createDocumentRepository(pool)
    const draft=await repo.create({projectId:'owned',documentType:'readme',title:'README',markdown:'# Test'},owner)
    const pending=await repo.prepareGeneration({projectId:'owned',documentType:'readme',title:'Generated later',provider:'gemini',model:'test-model',fileIds:[fileId]},owner)
    assert.equal(pending.sourceReferences[0].hash,hash)
    await repo.startGeneration(pending.id,owner)
    await repo.completeGeneration(pending.id,owner,'# Stored only; no AI call',{filesSubmitted:1,filesIncluded:1,filesSkipped:0,filesFailed:0,truncated:false},[{fileId,path:'app.js',lineStart:1,lineEnd:1}])
    await pool.end();pool=null;restarted=new Pool(options);repo=createDocumentRepository(restarted)
    assert.equal((await repo.read(pending.id,owner)).generationStatus,'Completed')
    assert.deepEqual((await repo.read(pending.id,owner)).sourceReferences[0].lineRanges,[{lineStart:1,lineEnd:1}])
    assert.equal((await repo.list(owner,{projectId:'owned',limit:'1',offset:'0'})).total,2)
    assert.equal(await repo.read(draft.id,other),null)
    for(const operation of [()=>repo.update(draft.id,other,{title:'Forbidden'}),()=>repo.remove(draft.id,other),()=>repo.list(other,{projectId:'owned'}),()=>repo.create({projectId:'owned',documentType:'readme',title:'Forbidden'},other)]) await assert.rejects(operation(),e=>e.code==='not_found')
    await repo.update(draft.id,owner,{markdown:'# Updated'})
    assert.equal((await repo.read(draft.id,owner)).markdown,'# Updated')
    await assert.rejects(repo.startGeneration(pending.id,owner),e=>e.code==='document_state_conflict')
    await repo.remove(draft.id,owner);assert.equal(await repo.read(draft.id,owner),null)
  } finally {
    if(pool) await pool.end()
    if(restarted) await restarted.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.end()
  }
})
