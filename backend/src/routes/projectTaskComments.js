const {Router}=require('express')
const rateLimit=require('express-rate-limit')
const {asyncHandler}=require('../middleware/http')
const v=require('../services/taskCommentValidation')
const router=Router({mergeParams:true})
const additions=rateLimit({windowMs:60000,max:30,keyGenerator:req=>req.user.sub,standardHeaders:true,legacyHeaders:false,message:{code:'comment_rate_limited',message:'Too many comment submissions. Try again later.'}})
async function query(req,method,...args){
 try{
  const repository=req.app.locals.taskCommentRepository || require('../db/taskCommentRepository').createTaskCommentRepository(require('../db/postgres'))
  return await repository[method](...args)
 }catch(error){
  if(['invalid_request','not_found','unauthorized','comment_request_conflict'].includes(error.code))throw error
  throw v.error('comment_storage_unavailable','Task comment storage is unavailable.',503)
 }
}
router.get('/',asyncHandler(async(req,res)=>{
 const id=v.uuid(req.params.taskId);v.pagination(id,req.query)
 res.json(await query(req,'list',id,req.user.sub,req.query))
}))
router.post('/',additions,asyncHandler(async(req,res)=>{
 const id=v.uuid(req.params.taskId);v.keys(req.query,[])
 const result=await query(req,'create',id,req.user.sub,v.input(req.body))
 res.status(result.created?201:200).json({comment:result.comment})
}))
router.use((error,req,res,next)=>{
 if(error.status && ['invalid_request','not_found','unauthorized','comment_request_conflict','comment_storage_unavailable'].includes(error.code))return res.status(error.status).json({code:error.code,message:error.message,requestId:req.requestId})
 next(error)
})
module.exports=router
