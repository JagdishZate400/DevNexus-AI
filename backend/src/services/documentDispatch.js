const config=require('../config')
const v=require('./documentValidation')
const {generateProjectOverview}=require('./documentGeneration')
const {specification,responseSchema,prompt}=require('./documentSpecifications')
const {buildCatalog,promptCatalog,validateOrganization,renderDocument}=require('./documentCatalog')
const {generateContent,aiError,safeDiagnostic}=require('./gemini')
const {sourceError}=require('./sourceArchive')
function sameFiles(a,b) {
 return a.length===b.length && a.every(f=>b.some(g=>f.id===g.id&&f.path===g.path&&f.sha256===g.sha256&&f.storageKind===g.storageKind))
}
async function generateDocument({input,ownerId,sources,documents,evidence,diagnostic=event=>console.warn(JSON.stringify(event))}) {
 input=v.generationRequest(input)
 if(input.documentType==='project-overview')return generateProjectOverview({input,ownerId,sources,documents,diagnostic})
 if(!ownerId)throw sourceError('unauthorized','Sign in to generate documentation.',401)
 if(!await sources.findProject(input.projectId,ownerId))throw sourceError('not_found','Owned project not found.',404)
 if(input.requestId && documents.replayGeneration) {
  const replay=await documents.replayGeneration(input,ownerId)
  if(replay)return replay
 }
 const spec=specification(input.documentType)
 const snapshot=await evidence.generationSnapshot(input.projectId,ownerId)
 const catalog=buildCatalog(snapshot,spec),context=promptCatalog(catalog)
 if(config.aiProvider!=='gemini')throw aiError('ai_configuration','Documentation generation requires Gemini.',503)
 const pending=await documents.prepareGeneration({...input,title:spec.title,provider:'gemini',model:config.geminiModel,
  fileIds:snapshot.files.filter(f=>f.storageKind==='source').map(f=>f.id),
  evidenceFileIds:snapshot.files.filter(f=>f.storageKind==='documentation-evidence').map(f=>f.id),
 },ownerId)
 if(!pending?.id)throw sourceError('document_storage_unavailable','Document preparation could not be confirmed.',503)
 if(pending.generationReplay){const {generationReplay,...saved}=pending;return saved}
 try {
  const expected=snapshot.files.map(f=>({fileId:f.id,path:f.path,hash:f.sha256,kind:f.storageKind}))
  if(pending.sourceReferences.length!==expected.length || expected.some(f=>!pending.sourceReferences.some(g=>g.fileId===f.fileId&&g.path===f.path&&g.hash===f.hash&&g.kind===f.kind)))throw sourceError('source_changed','Prepared document evidence does not match the snapshot.',409)
  await documents.startGeneration(pending.id,ownerId)
  // Re-read through the owner-scoped repository immediately before transmission.
  const current=await evidence.generationSnapshot(input.projectId,ownerId)
  if(!sameFiles(snapshot.files,current.files))throw sourceError('source_changed','Documentation evidence changed before generation.',409)
  const text=await generateContent({system:prompt(spec),json:true,responseSchema:responseSchema(spec),contents:[{role:'user',parts:[{text:context}]}],
   diagnostic:event=>safeDiagnostic(diagnostic,{module:'documentation',documentType:spec.id,documentId:pending.id,...event})})
  const sections=validateOrganization(text,catalog,spec)
  const markdown=renderDocument(spec,catalog,sections)
  // Revalidate the actual content/hashes and full membership after provider work.
  const after=await evidence.generationSnapshot(input.projectId,ownerId)
  if(!sameFiles(snapshot.files,after.files))throw sourceError('source_changed','Documentation evidence changed during generation.',409)
  const coverage={filesSubmitted:snapshot.files.length,filesIncluded:catalog.includedFileIds.length,filesSkipped:snapshot.files.length-catalog.includedFileIds.length,filesFailed:0,truncated:false}
  const document=await documents.completeGeneration(pending.id,ownerId,markdown,coverage,catalog.citations)
  if(document?.generationStatus!=='Completed')throw sourceError('document_storage_unavailable','Document completion could not be confirmed.',503)
  return document
 } catch(error) {
  const code=['ai_malformed_response','ai_output_limit'].includes(error.code)?'ai_invalid_response':v.FAILURE_CODES.includes(error.code)?error.code:'generation_failed'
  let failurePersisted=false
  try{failurePersisted=(await documents.failGeneration(pending.id,ownerId,code))?.generationStatus==='Failed'}catch{}
  const publicError=error.status&&error.code?error:sourceError('generation_failed','Documentation generation failed.',500)
  publicError.documentId=pending.id;publicError.failurePersisted=failurePersisted;throw publicError
 }
}
module.exports={generateDocument,sameFiles}
