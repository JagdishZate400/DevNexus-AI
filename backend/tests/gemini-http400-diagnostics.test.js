require('./helpers/offline')
const {test}=require('node:test')
const assert=require('node:assert/strict')
const config=require('../src/config')
Object.assign(config,{geminiApiKey:'private-api-key',geminiModel:'test-model',geminiTimeoutMs:1000})
const {generateContent}=require('../src/services/gemini')
const {sanitizeProviderError}=require('../src/services/geminiDiagnostics')
const payload={error:{code:400,status:'INVALID_ARGUMENT',message:'private prompt/source: schema exceeds maximum nesting depth; private-api-key',details:[
  {'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'API_KEY_INVALID',metadata:{key:'private-api-key'}},
  {'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'private-secret-reason'},
  {'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{field:'generation_config.response_schema.properties.claims.items',description:'private-source'},{field:'generation_config.response_schema.properties.private_secret'},{field:'generation_config.response_schema.properties.claims[0].properties.citations'}]},
]}}
async function mock(fetch,run){const original=global.fetch;global.fetch=fetch;try{await run()}finally{global.fetch=original}}
const input={contents:[{role:'user',parts:[{text:'private prompt/source'}]}]}
test('HTTP 400 preserves public classification and emits only bounded allowlisted provider details',async()=>{
 const events=[]
 await mock(async()=>new Response(JSON.stringify(payload),{status:400}),async()=>{
  await assert.rejects(generateContent({...input,diagnostic:event=>events.push(event)}),e=>e.code==='ai_request_rejected' && e.status===503 && e.message==='Gemini rejected the request. Check the server API key and model configuration.')
 })
 assert.equal(events.length,1);const event=events[0]
 assert.equal(event.httpStatus,400);assert.equal(event.category,'ai_request_rejected');assert.equal(event.diagnosticCategory,'http_400');assert.equal(event.providerCategory,'api_key_rejected');assert.equal(event.model,'test-model')
 assert.deepEqual(event.providerReasons,['API_KEY_INVALID'])
 assert.deepEqual(event.schemaFields,['generation_config.response_schema.properties.claims.items','generation_config.response_schema.properties.claims.properties.citations'])
 assert.doesNotMatch(JSON.stringify(events),/private|Authorization|x-goog-api-key/)
 assert.ok(JSON.stringify(events).length<4096)
})
test('schema complexity and invalid schema are fixed diagnostic categories, not raw messages',()=>{
 for(const [message,category] of [['Schema exceeds maximum allowed nesting depth','schema_complexity'],['Unsupported response schema field','schema_invalid'],['Other provider rejection','INVALID_ARGUMENT']]){
  const data=sanitizeProviderError({error:{code:400,status:'INVALID_ARGUMENT',message}},400)
  assert.equal(data.providerCategory,category);assert.equal(Object.hasOwn(data,'message'),false)
 }
})
test('oversized, malformed and interrupted HTTP 400 bodies never change public outcomes',async()=>{
 for(const create of [()=>new Response('x'.repeat(32769),{status:400}),()=>new Response('<html>private proxy body</html>',{status:400}),()=>new Response(new ReadableStream({start(controller){controller.error(new Error('private-stream-error'))}}),{status:400})]){
  const events=[]
  await mock(async()=>create(),async()=>{await assert.rejects(generateContent({...input,diagnostic:e=>events.push(e)}),e=>e.code==='ai_request_rejected')})
  assert.equal(events[0].httpStatus,400);assert.doesNotMatch(JSON.stringify(events),/private|xxxx/)
 }
})
test('stalled diagnostic stream has its own deadline; callback failures cannot alter HTTP category',async()=>{
 await mock(async()=>new Response(new ReadableStream({start(){},cancel(){}}),{status:400}),async()=>{
  const start=Date.now()
  await assert.rejects(generateContent({...input,diagnostic(){throw new Error('diagnostic failure')}}),e=>e.code==='ai_request_rejected')
  assert.ok(Date.now()-start<900)
 })
})
test('diagnostics do not read HTTP 400 bodies without opt-in; unrecognized provider values are suppressed',async()=>{
 let accessed=false
 await mock(async()=>({status:400,ok:false,get body(){accessed=true;throw new Error('should not read')}}),async()=>{await assert.rejects(generateContent(input),e=>e.code==='ai_request_rejected')})
 assert.equal(accessed,false)
 assert.deepEqual(sanitizeProviderError({error:{code:401,status:'PRIVATE_STATUS',message:'private'}},400),{providerCategory:'unrecognized_error',providerReasons:[],schemaFields:[]})
})
