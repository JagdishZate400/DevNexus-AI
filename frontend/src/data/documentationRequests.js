import {DOCUMENTATION_TYPES} from './documentationTypes.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function generationPayload(input){
  if(!input||Object.keys(input).some(key=>!['projectId','documentType','requestId'].includes(key))||typeof input.projectId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(input.projectId)||!DOCUMENTATION_TYPES.some(type=>type.id===input.documentType)||!UUID.test(input.requestId))throw Error('Invalid documentation generation request.')
  return Object.freeze({projectId:input.projectId,documentType:input.documentType,requestId:input.requestId})
}
export function newGenerationRequest(projectId,documentType,uuid=()=>globalThis.crypto.randomUUID()){
  return generationPayload({projectId,documentType,requestId:uuid()})
}
const errors={
  document_generation_active:'Another generation is active for this project. Refresh saved history to check its progress.',
  document_request_conflict:'This request conflicts with an existing or deleted result. Review saved history before starting a new generation.',
  documentation_evidence_insufficient:'This document needs more source evidence. Review the evidence requirements and upload the missing files before trying again.',
  documentation_context_limit:'The available source exceeds the documentation limits. No partial document was generated.',
  document_requests_unavailable:'Generation request tracking is unavailable. This workflow needs backend validation before it can continue.',
  document_evidence_unavailable:'Documentation evidence is unavailable. Retry after the source evidence service is ready.',
  invalid_request:'The documentation request was not accepted. Check the project and document type.',
  unsupported_document_type:'This document type is unavailable.',
  document_request_expired:'The generation request has expired. Review its saved outcome before starting a new operation.',
  ai_timeout:'Gemini timed out. The saved outcome must be checked before another operation.',
  ai_quota:'Gemini quota or rate limit was reached. Wait before starting another generation.',
  ai_request_rejected:'Gemini rejected this request. The provider configuration or response contract needs verification.',
  ai_malformed_response:'Gemini returned unsupported content. No verified completion was reported.',
  ai_authentication:'Gemini access could not be verified. Generation is unavailable.',
  ai_model_unavailable:'The configured AI model is unavailable.',
  ai_configuration:'Gemini configuration needs verification before generation can continue.',
  ai_rate_limited:'Gemini is rate limited. Wait before trying again.',
  ai_invalid_response:'Gemini returned content that failed validation. Review the saved failure before starting again.',
  ai_output_limit:'Gemini output exceeded the supported limits. No verified completion was reported.',
  ai_blocked:'Gemini blocked this generation. No verified completion was reported.',
  empty_source_project:'This project has no uploaded source files. Upload source before generating documentation.',
  documentation_source_unsupported:'Some uploaded source cannot be safely included. No partial overview was generated.',
  source_changed:'The uploaded evidence changed during generation. Review history and start a new operation with the current source.',
}
export function generationErrorMessage(error){
  if(error.name==='AbortError'||error.name==='TimeoutError')return 'Request timed out. The generation outcome is unconfirmed.'
  return (Object.hasOwn(errors,error.data?.code)?errors[error.data.code]:null) || (error.status?error.message:'Connection or response failure; generation outcome is unknown.')
}
// An absent/partial response is uncertain. A known preflight rejection or a saved
// Failed record is definitive. History alone cannot bind a result to a request key.
export function generationOutcomeUnknown(error){
  if(error.data?.failurePersisted===true)return false
  // A proxy timeout may arrive after the server accepted the operation.
  if(error.status===408||error.status===504)return true
  if(error.status>=400&&error.status<500)return false
  if(['document_requests_unavailable','document_evidence_unavailable','documentation_evidence_insufficient','documentation_context_limit','ai_configuration'].includes(error.data?.code))return false
  return true
}
