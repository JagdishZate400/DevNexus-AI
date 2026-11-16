const { normalizeReviewOptions } = require('../services/reviewOptions')
const { Router }=require('express')
const { body,param }=require('express-validator')
const rateLimit=require('express-rate-limit')
const config=require('../config')
const { authRequired }=require('../middleware/auth')
const { asyncHandler,validate }=require('../middleware/http')
const { sourceQuery }=require('./workspace')
const { sourceError }=require('../services/sourceArchive')
const { validateReviewSource }=require('../services/reviewSource')
const { analyzeSource,aiError }=require('../services/gemini')
const router=Router()
router.use(authRequired)
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next()})

async function reviewQuery(req,method,...args) {
  try {
    const repo=req.app.locals.reviewRepository || require('../db/reviewRepository').createReviewRepository(require('../db/postgres'))
    return await repo[method](...args)
  } catch(err) {
    if(err.code==='not_found') throw err
    throw sourceError('review_storage_unavailable','Review storage is unavailable. Apply the D1 migration and check PostgreSQL.',503)
  }
}
const idValidation=[param('id').isUUID()]
router.get('/',asyncHandler(async(req,res)=>res.json({reviews:await reviewQuery(req,'list',req.user.sub)})))
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await reviewQuery(req, 'getStats', req.user.sub)
  return res.json({
    stats,
    quality: {
      status: 'not_evaluated',
      metrics: [
        { label: 'Readability', value: 'Not evaluated' },
        { label: 'Maintainability', value: 'Not evaluated' },
        { label: 'Performance', value: 'Not evaluated' },
        { label: 'Best Practices', value: 'Not evaluated' },
      ],
      methodology: 'Automated percentage scoring is not evaluated without a dedicated static analysis benchmark suite. Reviews record grounded findings by category and severity.',
    },
  })
}))
router.get('/:id',idValidation,validate,asyncHandler(async(req,res)=>{
  const review=await reviewQuery(req,'read',req.params.id,req.user.sub)
  if(!review) throw sourceError('not_found','Review not found.',404)
  return res.json({review})
}))
router.post('/',rateLimit({windowMs:60000,max:10,standardHeaders:true,legacyHeaders:false}),[
  body('projectId').isString().bail().matches(/^[a-zA-Z0-9_-]{1,160}$/),
  body('fileId').isUUID(),
  body('options').optional().isObject(),
  body('options.focus').optional().isIn(['General','Bugs','Security','Maintainability','BugsAndSecurity']),
],validate,asyncHandler(async(req,res)=>{
  if(Object.keys(req.body).some((key)=>!['projectId','fileId','options'].includes(key))) throw sourceError('invalid_request','Submit projectId, fileId and supported review options only.')
  const options=normalizeReviewOptions(req.body.options)
  if(config.aiProvider!=='gemini') throw aiError('ai_configuration','Repository review requires the Gemini provider.',503)
  // Durable source ownership is authoritative; no manager bypass and no browser source/path.
  const project=await sourceQuery(req,'findProject',req.body.projectId,req.user.sub)
  if(!project) throw sourceError('not_found','Owned source project not found.',404)
  const file=await sourceQuery(req,'readFile',project.id,req.body.fileId,req.user.sub)
  if(!file) throw sourceError('not_found','Owned source file not found.',404)
  const sourceCoverage=validateReviewSource(file)
  const hash=sourceCoverage.sourceHash

  const coverage={...sourceCoverage,scope:'Single File',filesReviewed:0,filesSubmitted:1}
  const id=await reviewQuery(req,'start',{projectId:project.id,fileId:file.id,sourceHash:hash,coverage,options,model:config.geminiModel},req.user.sub)
  try {
    const findings=await analyzeSource({code:file.content,language:file.language.toLowerCase(),file:file.path,focus:options.focus,analysisFocus:options.analysisFocus})
    const review=await reviewQuery(req,'complete',id,req.user.sub,findings)
    return res.status(201).json({review})
  } catch(err) {
    const code=err.code?.startsWith('ai_') ? err.code : 'review_failed'
    await reviewQuery(req,'fail',id,req.user.sub,code)
    throw err
  }
}))
router.patch('/:id/findings/:findingId',[
  ...idValidation,param('findingId').isString().isLength({min:1,max:80}),
  body('status').isIn(['Open','Reviewed','False Positive','Fixed']),
],validate,asyncHandler(async(req,res)=>res.json({review:await reviewQuery(req,'triage',req.params.id,req.params.findingId,req.user.sub,req.body.status)})))
router.use((err,req,res,next)=>{
  if(err.status && err.code) return res.status(err.status).json({code:err.code,message:err.message,requestId:req.requestId})
  return next(err)
})
module.exports=router
