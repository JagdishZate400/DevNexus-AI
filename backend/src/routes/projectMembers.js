const {Router}=require('express')
const rateLimit=require('express-rate-limit')
const {authRequired}=require('../middleware/auth')
const {asyncHandler}=require('../middleware/http')
const v=require('../services/membershipValidation')
const router=Router()
router.use(authRequired)
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next()})
// Per authenticated user, shared across their owned projects; also under global IP limiter.
const additions=rateLimit({windowMs:15*60*1000,max:10,keyGenerator:req=>req.user.sub,standardHeaders:true,legacyHeaders:false,message:{code:'member_add_rate_limited',message:'Too many member additions. Try again later.'}})
async function query(req,method,...args){
 try{
  const repository=req.app.locals.membershipRepository || require('../db/membershipRepository').createMembershipRepository(require('../db/postgres'))
  return await repository[method](...args)
 }catch(error){
  if(['invalid_request','not_found','member_not_added'].includes(error.code))throw error
  throw v.error('membership_storage_unavailable','Project membership storage is unavailable. Check PostgreSQL and migration 0148.',503)
 }
}
router.get('/projects',asyncHandler(async(req,res)=>{
 if(Object.keys(req.query).length)throw v.invalid()
 res.json(await query(req,'projects',req.user.sub))
}))
router.get('/directory',asyncHandler(async(req,res)=>{v.pagination(req.query);res.json(await query(req,'directory',req.user.sub,req.query))}))
router.get('/',asyncHandler(async(req,res)=>{v.pagination(req.query);res.json(await query(req,'list',req.user.sub,req.query))}))
router.post('/',additions,asyncHandler(async(req,res)=>res.status(201).json({member:await query(req,'create',v.input(req.body),req.user.sub)})))
router.patch('/:id',asyncHandler(async(req,res)=>{v.uuid(req.params.id);res.json({member:await query(req,'update',req.params.id,req.user.sub,v.input(req.body,true))})}))
router.delete('/:id',asyncHandler(async(req,res)=>{v.uuid(req.params.id);await query(req,'remove',req.params.id,req.user.sub);res.status(204).end()}))
router.use((error,req,res,next)=>{
 if(error.status && ['invalid_request','not_found','member_not_added','membership_storage_unavailable'].includes(error.code))return res.status(error.status).json({code:error.code,message:error.message,requestId:req.requestId})
 next(error)
})
module.exports=router
