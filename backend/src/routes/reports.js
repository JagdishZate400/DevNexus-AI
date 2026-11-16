const {Router}=require('express')
const {authRequired}=require('../middleware/auth')
const {asyncHandler}=require('../middleware/http')
const {reportsQuery}=require('../services/reporting')
const v=require('../services/reportValidation')
const router=Router()
router.use(authRequired)
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next()})
router.get('/projects',asyncHandler(async(req,res)=>{
 if(Object.keys(req.query).length)throw v.invalid()
 res.json(await reportsQuery(req,'projects',req.user.sub))
}))
router.get('/project',asyncHandler(async(req,res)=>res.json(await reportsQuery(req,'project',req.user.sub,v.projectQuery(req.query)))))
// Retire snapshots without reading, modifying or deleting old records.
const retired=(req,res)=>res.status(410).json({code:'reports_retired',message:'Legacy report snapshots are retired. Use the current-state owned-project report.'})
router.get('/',retired)
router.post('/generate',retired)
router.patch('/:id',retired)
router.use((err,req,res,next)=>{
 if(err.status&&['invalid_request','not_found','reports_unavailable'].includes(err.code))return res.status(err.status).json({code:err.code,message:err.message,requestId:req.requestId})
 next(err)
})
module.exports=router
