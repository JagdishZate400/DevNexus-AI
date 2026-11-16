const {Router}=require('express')
const {asyncHandler}=require('../middleware/http')
const v=require('../services/taskActivityValidation')
const router=Router({mergeParams:true})
router.get('/',asyncHandler(async(req,res)=>{
 const id=v.uuid(req.params.taskId),page=v.pagination(id,req.query)
 try{
  const repository=req.app.locals.taskActivityRepository||require('../db/taskActivityRepository').createTaskActivityRepository(require('../db/postgres'))
  res.json(v.page(await repository.list(id,req.user.sub,req.query),id,page.limit))
 }catch(error){
  if(['invalid_request','not_found'].includes(error.code))throw error
  throw v.error('activity_storage_unavailable','Task activity storage is unavailable.',503)
 }
}))
router.use((error,req,res,next)=>{
 if(error.status&&['invalid_request','not_found','activity_storage_unavailable'].includes(error.code))return res.status(error.status).json({code:error.code,message:error.message,requestId:req.requestId})
 next(error)
})
module.exports=router
