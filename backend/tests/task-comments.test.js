require('./helpers/offline')
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto')
const request=require('supertest')
const v=require('../src/services/taskCommentValidation')
const {createApp}=require('../src/app'),{createTestRepository}=require('./helpers/users'),{signToken}=require('../src/middleware/auth')
const {createTaskCommentRepository}=require('../src/db/taskCommentRepository')
const id=()=>crypto.randomUUID()
test('comments normalize line endings, retain plain text/whitespace and count Unicode characters',()=>{
 const requestId=id();assert.deepEqual(v.input({body:' x\r\ny\rz ',clientRequestId:requestId.toUpperCase()}),{body:' x\ny\nz ',clientRequestId:requestId})
 assert.equal(Array.from(v.input({body:'😀'.repeat(4000),clientRequestId:requestId}).body).length,4000)
 assert.equal(v.input({body:'<script>literal text</script>',clientRequestId:requestId}).body,'<script>literal text</script>')
 for(const body of ['', ' \t\n\r', '\u00a0',null,{},1,'x'.repeat(4001),'😀'.repeat(4001),'bad\0text','\ud800','\udc00'])assert.throws(()=>v.input({body,clientRequestId:requestId}),e=>e.code==='invalid_request')
 for(const value of [null,[],{}, {body:'valid'}, {body:'valid',clientRequestId:'invalid'}])assert.throws(()=>v.input(value))
})
test('comments reject forged identities, timestamps, task/project fields and prototype-bearing objects',()=>{
 for(const key of ['author','authorId','author_user_id','authorDisplayNameSnapshot','displayName','projectId','taskId','role','createdAt','timestamp','position','activity','eventType','changes','id'])assert.throws(()=>v.input({body:'text',clientRequestId:id(),[key]:'forged'}))
 assert.throws(()=>v.input(Object.assign(Object.create({admin:true}),{body:'text',clientRequestId:id()})))
})
test('comment cursors use bounded decimal BIGINTs, strict scope/version/stream and page bounds',()=>{
 const task=id(),cursor=v.cursor(task,'9007199254740993')
 assert.deepEqual(v.pagination(task,{}),{limit:20,before:null});assert.deepEqual(v.pagination(task,{limit:'50',before:cursor}),{limit:50,before:'9007199254740993'})
 for(const limit of ['0','51','01','1.5','1e1','-1','',[],true,Infinity])assert.throws(()=>v.pagination(task,{limit}))
 for(const before of ['', '%%%','a'.repeat(513),cursor+'=',v.cursor(id(),'1'),Buffer.from(JSON.stringify({v:2,taskId:task,stream:'comments',before:'1'})).toString('base64url'),Buffer.from(JSON.stringify({v:1,taskId:task,stream:'activity',before:'1'})).toString('base64url'),v.cursor(task,'0'),v.cursor(task,'-1'),v.cursor(task,'01'),v.cursor(task,'9223372036854775808'),v.cursor(task,'1.5'),Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({v:1,taskId:task,stream:'comments',before:'1',extra:true})).toString('base64url')])assert.throws(()=>v.pagination(task,{before}))
 assert.throws(()=>v.pagination(task,{offset:'0'}));assert.throws(()=>v.pagination(task,{limit:['1','2']}))
})
async function apiFixture(){
 const users=createTestRepository(),owner={id:id(),email:'owner@comments.test',role:'Developer',fullName:'Registered owner'};await users.createUser(owner)
 const task=id(),calls=[]
 const comment={id:id(),taskId:task,author:{userId:owner.id,displayName:owner.fullName},body:'Plain comment',createdAt:new Date().toISOString(),position:'9007199254740993',clientRequestId:id()}
 const repo={async create(...args){calls.push(['create',...args]);return {comment,created:true}},async list(...args){calls.push(['list',...args]);return {taskId:task,comments:[comment],limit:20,nextCursor:null,hasMore:false}}}
 return {users,owner,task,comment,repo,calls,token:signToken(owner),app:createApp({userRepository:users,taskCommentRepository:repo})}
}
test('mocked API wiring returns canonical creation/retry/page shapes with no-store',async()=>{
 const f=await apiFixture(),url='/api/project-tasks/'+f.task+'/comments'
 let r=await request(f.app).post(url).set('Authorization','Bearer '+f.token).send({body:'Plain\r\ncomment',clientRequestId:f.comment.clientRequestId})
 assert.equal(r.status,201);assert.deepEqual(r.body,{comment:f.comment});assert.equal(r.headers['cache-control'],'no-store');assert.equal(f.calls[0][3].body,'Plain\ncomment')
 f.repo.create=async()=>({comment:f.comment,created:false});r=await request(f.app).post(url).set('Authorization','Bearer '+f.token).send({body:'Plain comment',clientRequestId:f.comment.clientRequestId});assert.equal(r.status,200)
 r=await request(f.app).get(url).set('Authorization','Bearer '+f.token);assert.equal(r.status,200);assert.equal(r.body.comments[0].position,'9007199254740993');assert.equal(r.headers['cache-control'],'no-store')
})
test('mocked API rejects anonymous/invalid/revoked/unregistered auth before repository calls',async()=>{
 const f=await apiFixture(),url='/api/project-tasks/'+f.task+'/comments'
 const missing=signToken({id:id(),email:'missing@test',role:'Project Manager'}),revoked=signToken({...f.owner,tokenVersion:1})
 for(const token of [null,'invalid',missing,revoked])for(const method of ['get','post']){
  let req=request(f.app)[method](url);if(token)req=req.set('Authorization','Bearer '+token);if(method==='post')req=req.send({body:'text',clientRequestId:id()});const r=await req;assert.equal(r.status,401);assert.equal(r.headers['cache-control'],'no-store')
 }
 assert.equal(f.calls.length,0)
})
test('mocked API validates requests and passes only registered identity; malformed JSON stays no-store',async()=>{
 const f=await apiFixture(),url='/api/project-tasks/'+f.task+'/comments'
 for(const data of [{body:' ',clientRequestId:id()},{body:'valid',clientRequestId:'bad'},{body:'valid',clientRequestId:id(),authorId:f.owner.id}])assert.equal((await request(f.app).post(url).set('Authorization','Bearer '+f.token).send(data)).status,400)
 for(const query of ['?limit=51','?offset=0','?limit=1&limit=2','?before=bad'])assert.equal((await request(f.app).get(url+query).set('Authorization','Bearer '+f.token)).status,400)
 assert.equal((await request(f.app).post(url+'?projectId=foreign').set('Authorization','Bearer '+f.token).send({body:'text',clientRequestId:id()})).status,400)
 const malformed=await request(f.app).post(url).set('Content-Type','application/json').set('Authorization','Bearer '+f.token).send('{');assert.equal(malformed.status,400);assert.equal(malformed.headers['cache-control'],'no-store');assert.equal(f.calls.length,0)
 const sensitive=await request(f.app).post(url).set('Content-Type','application/json').set('Authorization','Bearer '+f.token).send('{"body":"private-comment-sentinel", "clientRequestId": invalid}')
 assert.equal(sensitive.status,400);assert.doesNotMatch(JSON.stringify(sensitive.body),/private-comment-sentinel|SyntaxError/)
 const large=await request(f.app).post(url).set('Authorization','Bearer '+f.token).send({body:'x'.repeat(110000),clientRequestId:id()});assert.equal(large.status,413);assert.equal(large.headers['cache-control'],'no-store');assert.equal(f.calls.length,0)
})
test('mocked API limits authenticated comment writes and keeps rate-limit responses no-store',async()=>{
 const f=await apiFixture(),url='/api/project-tasks/'+f.task+'/comments'
 for(let i=0;i<30;i++)assert.equal((await request(f.app).post(url).set('Authorization','Bearer '+f.token).send({body:'text',clientRequestId:id()})).status,201)
 const blocked=await request(f.app).post(url).set('Authorization','Bearer '+f.token).send({body:'text',clientRequestId:id()});assert.equal(blocked.status,429);assert.equal(blocked.headers['cache-control'],'no-store');assert.equal(f.calls.length,30)
})
test('mocked API preserves 404/409 and sanitizes storage failures without logging private errors',async()=>{
 const f=await apiFixture(),url='/api/project-tasks/'+f.task+'/comments'
 for(const method of ['get','post'])for(const status of [404,409,503]){
  f.repo[method==='get'?'list':'create']=async()=>{if(status===503)throw new Error('private body password connection-string');throw v.error(status===404?'not_found':'comment_request_conflict','Safe error',status)}
  let req=request(f.app)[method](url).set('Authorization','Bearer '+f.token);if(method==='post')req=req.send({body:'text',clientRequestId:id()});const r=await req;assert.equal(r.status,status);assert.equal(r.headers['cache-control'],'no-store');assert.doesNotMatch(JSON.stringify(r.body),/private|password|connection-string/)
 }
})
test('repository rolls back commit failures and releases the connection without returning false success',async()=>{
 const task=id(),owner=id(),calls=[]
 const client={async query(sql,args){calls.push(sql);if(sql==='COMMIT')throw Error('commit failed');if(sql.startsWith('SELECT project_id'))return {rows:[{project_id:'owned'}]};if(sql.startsWith('SELECT id FROM'))return {rows:[{id:task}]};if(sql.startsWith('SELECT id,full_name'))return {rows:[{id:owner,full_name:'Owner'}]};if(sql.startsWith('INSERT'))return {rows:[{id:id(),task_id:task,author_user_id:owner,author_display_name_snapshot:'Owner',body:'text',created_at:new Date(),position:'1',client_request_id:args[5]}]};return {rows:[]}},release(){calls.push('release')}}
 const repo=createTaskCommentRepository({async connect(){return client}});await assert.rejects(repo.create(task,owner,{body:'text',clientRequestId:id()}),/commit failed/);assert.deepEqual(calls.slice(-3),['COMMIT','ROLLBACK','release']);assert(calls.findIndex(x=>x.startsWith('SELECT id FROM source_projects'))<calls.findIndex(x=>x.startsWith('INSERT')))
})
