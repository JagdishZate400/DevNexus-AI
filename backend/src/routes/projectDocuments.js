const { Router } = require('express')
const { authRequired } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/http')
const { sourceError } = require('../services/sourceArchive')
const v = require('../services/documentValidation')
const rateLimit = require('express-rate-limit')
const { sourceQuery } = require('./workspace')
const { generateDocument } = require('../services/documentDispatch')
const router = Router()
router.use(authRequired)
router.use((req,res,next) => { res.set('Cache-Control','no-store'); next() })
async function query(req, method, ...args) {
  try {
    const repository = req.app.locals.documentRepository || require('../db/documentRepository').createDocumentRepository(require('../db/postgres'))
    return await repository[method](...args)
  } catch (err) {
    if (['not_found','invalid_request','document_state_conflict','source_changed','document_request_conflict','document_generation_active','document_requests_unavailable'].includes(err.code)) throw err
    throw sourceError('document_storage_unavailable','Durable document storage is unavailable. Check PostgreSQL and migration 0145.',503)
  }
}
async function read(req) {
  v.uuid(req.params.id)
  const document = await query(req,'read',req.params.id,req.user.sub)
  if (!document) throw sourceError('not_found','Owned document not found.',404)
  return document
}
router.get('/',asyncHandler(async(req,res) => {
  v.pagination(req.query)
  res.json(await query(req,'list',req.user.sub,req.query))
}))
router.post('/',asyncHandler(async(req,res) => res.status(201).json({ document: await query(req,'create',v.draft(req.body),req.user.sub) })))
router.post('/generate',rateLimit({windowMs:60000,max:3,standardHeaders:true,legacyHeaders:false}),asyncHandler(async(req,res) => {
  const input = v.generationRequest(req.body)
  const sources = Object.fromEntries(['findProject','discoverReviewFiles','readFile'].map(method=>[method,(...args)=>sourceQuery(req,method,...args)]))
  const repository = req.app.locals.documentRepository
  const documents = Object.fromEntries(['prepareGeneration','startGeneration','completeGeneration','failGeneration'].map(method=>[method,(...args)=>query(req,method,...args)]))
  if (!repository || repository.replayGeneration) documents.replayGeneration=(...args)=>query(req,'replayGeneration',...args)
  const evidence={generationSnapshot:(...args)=>evidenceQuery(req,'generationSnapshot',...args)}
  res.status(201).json({document:await generateDocument({input,ownerId:req.user.sub,sources,documents,evidence})})
}))
router.post('/recover',asyncHandler(async(req,res)=>{
  const input=v.generationRequest(req.body)
  if(input.requestId) throw v.invalid()
  res.json(await query(req,'recoverAbandoned',input.projectId,req.user.sub))
}))
async function evidenceQuery(req,method,...args) {
  try {
    const repo=req.app.locals.documentEvidenceRepository || require('../db/documentEvidenceRepository').createDocumentEvidenceRepository(require('../db/postgres'))
    return await repo[method](...args)
  } catch(error) {
    if(['not_found','invalid_request','unsupported_file','context_limit','path_conflict'].includes(error.code) && error.status) throw error
    if(error.code && ['invalid_path','unsupported_file','invalid_file','file_limit','context_limit','sensitive_or_invalid_content','invalid_text','configuration_value_rejected','malformed_manifest','unsupported_lockfile','source_integrity','duplicate_file','malformed_source','token_limit'].includes(error.code)) throw sourceError(error.code,'Documentation evidence was rejected.',['file_limit','context_limit','token_limit'].includes(error.code)?413:400)
    throw sourceError('document_evidence_unavailable','Documentation evidence storage is unavailable. Check migration 0157.',503)
  }
}
router.post('/evidence',rateLimit({windowMs:60000,max:10,standardHeaders:true,legacyHeaders:false}),asyncHandler(async(req,res)=>{
  if(!req.body || Object.keys(req.body).some(k=>!['projectId','files'].includes(k))) throw v.invalid()
  v.pagination({projectId:req.body.projectId})
  res.status(201).json(await evidenceQuery(req,'add',req.body.projectId,req.user.sub,req.body.files))
}))
router.get('/evidence',asyncHandler(async(req,res)=>{
  if(Object.keys(req.query).some(k=>k!=='projectId')) throw v.invalid()
  v.pagination(req.query)
  res.json(await evidenceQuery(req,'evidence',req.query.projectId,req.user.sub))
}))
router.get('/:id/markdown',asyncHandler(async(req,res) => {
  const document = await read(req)
  res.set({ 'Content-Type':'text/markdown; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="document-${document.id}.md"` })
  res.send(document.markdown)
}))
router.get('/:id',asyncHandler(async(req,res) => res.json({ document:await read(req) })))
router.patch('/:id',asyncHandler(async(req,res) => {
  v.uuid(req.params.id)
  res.json({ document:await query(req,'update',req.params.id,req.user.sub,v.draft(req.body,true)) })
}))
router.delete('/:id',asyncHandler(async(req,res) => {
  v.uuid(req.params.id)
  await query(req,'remove',req.params.id,req.user.sub)
  res.status(204).end()
}))
router.use((err,req,res,next) => {
  if (err.status && err.code) return res.status(err.status).json({ code:err.code,message:err.message,requestId:req.requestId,...(err.documentId ? {documentId:err.documentId,failurePersisted:err.failurePersisted} : {}) })
  next(err)
})
module.exports = router
