require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('crypto')
const fs=require('fs')
const path=require('path')
const {Pool}=require('pg')
const {createReviewRepository}=require('../src/db/reviewRepository')
test('PostgreSQL review and finding status survive new connection pools and enforce ownership',{skip:!process.env.SOURCE_TEST_DATABASE_URL},async()=>{
  const schema=`review_test_${crypto.randomBytes(8).toString('hex')}`
  const connectionString=process.env.SOURCE_TEST_DATABASE_URL
  const admin=new Pool({connectionString,connectionTimeoutMillis:5000})
  let pool,restarted
  try{
    await admin.query(`CREATE SCHEMA ${schema}`)
    const options={connectionString,options:`-c search_path=${schema}`,connectionTimeoutMillis:5000}
    pool=new Pool(options);await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)')
    for(const name of ['0132-source-workspace.sql','0141-repository-reviews.sql','0144-review-finding-type.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/migrations',name),'utf8'))
    const owner=crypto.randomUUID(),other=crypto.randomUUID(),fid=crypto.randomUUID(),hash=crypto.createHash('sha256').update('eval(x)').digest('hex')
    await pool.query('INSERT INTO users(id) VALUES($1),($2)',[owner,other]);await pool.query('INSERT INTO source_projects(id,owner_id,name) VALUES($1,$2,$3)',['p',owner,'Project'])
    await pool.query('INSERT INTO source_files(id,project_id,path,language,content,byte_size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[fid,'p','a.js','JavaScript','eval(x)',7,hash])
    let repo=createReviewRepository(pool)
    const id=await repo.start({projectId:'p',fileId:fid,sourceHash:hash,model:'test-model',coverage:{filesReviewed:1},options:{}},owner)
    await repo.complete(id,owner,[{id:'finding-test',severity:'High',category:'Security',line:'1',problem:'p',explanation:'e',improvement:'i',code:'eval(x)',suggestedCode:''}])
    assert.equal((await repo.read(id,owner)).findings[0].findingType,null)
    const bugId=await repo.start({projectId:'p',fileId:fid,sourceHash:hash,model:'test-model',coverage:{filesReviewed:1},options:{focus:'Bugs'}},owner)
    await repo.complete(bugId,owner,[{id:'bug-test',findingType:'Bug',severity:'High',category:'Runtime',line:'1',problem:'p',explanation:'e',improvement:'i',code:'eval(x)',suggestedCode:''}])
    await repo.triage(id,'finding-test',owner,'Reviewed')
    await pool.end();pool=null;restarted=new Pool(options);repo=createReviewRepository(restarted)
    assert.equal((await repo.read(id,owner)).findings[0].status,'Reviewed')
    assert.equal((await repo.list(owner)).length,2)
    assert.equal((await repo.read(bugId,owner)).findings[0].findingType,'Bug')
    assert.equal((await repo.read(id,owner)).findings[0].findingType,null)
    assert.equal(await repo.read(id,other),null)
    assert.deepEqual(await repo.list(other),[])
    await assert.rejects(repo.triage(id,'finding-test',other,'Fixed'),(e)=>e.code==='not_found')
  }finally{if(pool)await pool.end();if(restarted)await restarted.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()}
})
