import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {DOCUMENTATION_TYPES,ACCEPTED_DOCUMENT_TYPES,canGenerateDocumentType,canonicalDocumentType,documentTypeLabel,isLegacyDocumentType} from '../src/data/documentationTypes.js'
import {generationPayload,newGenerationRequest,generationOutcomeUnknown,generationErrorMessage} from '../src/data/documentationRequests.js'
const require=createRequire(import.meta.url)
const backend=require('../../backend/src/services/documentTypes.js') // Registry only: no app/config/env imports.
const UUID='11111111-1111-4111-8111-111111111111'
test('all nine frontend IDs and labels match the backend; aliases preserve historical IDs',()=>{
  assert.deepEqual(DOCUMENTATION_TYPES.map(type=>type.id),backend.CANONICAL_IDS)
  for(const type of DOCUMENTATION_TYPES){assert.equal(type.label,backend.DOCUMENT_TYPES.find(t=>t.id===type.id).displayName);assert.ok(type.description&&type.evidence);assert.ok(Object.isFrozen(type))}
  assert.equal(canonicalDocumentType('technical-architecture'),'architecture');assert.equal(canonicalDocumentType('code-documentation'),'module-documentation')
  assert.equal(documentTypeLabel('technical-architecture'),'Architecture Documentation');assert.equal(isLegacyDocumentType('code-documentation'),true)
  assert.equal(canonicalDocumentType('constructor'),null);assert.equal(documentTypeLabel('future-type'),'Unknown document type')
})
test('registry support cannot unlock acceptance; production gate permits all nine canonical documentation types',()=>{
  assert.deepEqual(ACCEPTED_DOCUMENT_TYPES,['project-overview','readme','installation-guide','architecture','project-structure','module-documentation','api-documentation','developer-notes','technology-stack'])
  for(const type of DOCUMENTATION_TYPES){
    assert.equal(canGenerateDocumentType(type.id),true)
    assert.equal(canGenerateDocumentType(type.id,backend.DOCUMENT_TYPES),false)
  }
  assert.equal(canGenerateDocumentType('unknown',['unknown']),false)
})
test('every canonical selection produces an exact immutable request; retries preserve identity',()=>{
  for(const type of DOCUMENTATION_TYPES){
    const request=newGenerationRequest('owned',type.id,()=>UUID)
    assert.deepEqual(request,{projectId:'owned',documentType:type.id,requestId:UUID});assert.ok(Object.isFrozen(request))
    assert.deepEqual(generationPayload(request),request)
  }
  const a=newGenerationRequest('owned','project-overview'),b=newGenerationRequest('owned','project-overview');assert.notEqual(a.requestId,b.requestId)
  for(const patch of [{documentType:'technical-architecture'},{documentType:'unknown'},{projectId:'../owned'},{requestId:'bad'},{source:'invented'}])assert.throws(()=>generationPayload({projectId:'owned',documentType:'readme',requestId:UUID,...patch}))
})
test('uncertain outcomes keep their key; explicit preflight rejection and saved failure are definitive',()=>{
  for(const error of [{name:'TimeoutError'},{status:408},{status:504},{status:503},{data:{failurePersisted:false}}])assert.equal(generationOutcomeUnknown(error),true)
  for(const error of [{status:409,data:{code:'document_generation_active'}},{status:503,data:{code:'document_requests_unavailable'}},{status:503,data:{failurePersisted:true}}])assert.equal(generationOutcomeUnknown(error),false)
  assert.match(generationErrorMessage({name:'TimeoutError'}),/timed out/)
  for(const code of ['documentation_evidence_insufficient','document_generation_active','document_request_expired','ai_request_rejected','document_requests_unavailable'])assert.ok(generationErrorMessage({data:{code}}).length>20)
})

test('provider and source failures have explicit messages; inherited keys are ignored',()=>{
  for(const code of ['ai_configuration','ai_rate_limited','ai_invalid_response','ai_output_limit','ai_blocked','empty_source_project','documentation_source_unsupported'])assert.equal(typeof generationErrorMessage({data:{code}}),'string')
  assert.match(generationErrorMessage({data:{code:'constructor'}}),/outcome is unknown/)
  assert.equal(generationOutcomeUnknown({status:408,data:{failurePersisted:true}}),false)
})
