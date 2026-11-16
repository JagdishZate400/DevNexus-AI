const {Router}=require('express')
const {authRequired}=require('../middleware/auth')
const {asyncHandler}=require('../middleware/http')
const v=require('../services/sprintValidation')
const router=Router()
router.use(authRequired)
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next()})
async function query(req,method,...args){
 try{
  const repository=req.app.locals.sprintRepository || require('../db/sprintRepository').createSprintRepository(require('../db/postgres'))
  return await repository[method](...args)
 }catch(error){
  if(['invalid_request','not_found','task_already_assigned'].includes(error.code))throw error
  throw v.error('sprint_storage_unavailable','Project sprint storage is unavailable. Check PostgreSQL and migration 0147.',503)
 }
}
router.get('/',asyncHandler(async(req,res)=>{v.page(req.query);res.json(await query(req,'list',req.user.sub,req.query))}))
router.post('/',asyncHandler(async(req,res)=>res.status(201).json({sprint:await query(req,'create',v.input(req.body),req.user.sub)})))
router.get('/:id',asyncHandler(async(req,res)=>{v.uuid(req.params.id);res.json({sprint:await query(req,'read',req.params.id,req.user.sub)})}))
router.patch('/:id',asyncHandler(async(req,res)=>{v.uuid(req.params.id);res.json({sprint:await query(req,'update',req.params.id,req.user.sub,v.input(req.body,true))})}))
router.get('/:id/tasks',asyncHandler(async(req,res)=>{v.uuid(req.params.id);v.page(req.query,false);res.json(await query(req,'tasks',req.params.id,req.user.sub,req.query))}))
for(const method of ['put','delete'])router[method]('/:id/tasks/:taskId',asyncHandler(async(req,res)=>{
 v.uuid(req.params.id);v.uuid(req.params.taskId)
 if(req.body!==undefined)v.keys(req.body,[])
 res.json({sprint:await query(req,'assign',req.params.id,req.params.taskId,req.user.sub,method==='delete')})
}))
router.use((error,req,res,next)=>{
 if(error.status && ['invalid_request','not_found','task_already_assigned','sprint_storage_unavailable'].includes(error.code))return res.status(error.status).json({code:error.code,message:error.message,requestId:req.requestId})
 next(error)
})
module.exports=router
