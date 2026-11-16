const {Router}=require('express')
const {authRequired}=require('../middleware/auth')
const {asyncHandler}=require('../middleware/http')
const v=require('../services/taskValidation')
const router=Router()
router.use(authRequired)
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next()})
router.use('/:taskId/comments',require('./projectTaskComments'))
router.use('/:taskId/activity',require('./projectTaskActivity'))
async function query(req,method,...args){
  try{
    const repository=req.app.locals.taskRepository || require('../db/taskRepository').createTaskRepository(require('../db/postgres'))
    return await repository[method](...args)
  }catch(error){
    if(['invalid_request','not_found','assignee_not_eligible'].includes(error.code))throw error
    throw v.taskError('task_storage_unavailable','Project task storage is unavailable. Check PostgreSQL and migrations 0146, 0147 and 0152.',503)
  }
}
router.post('/',asyncHandler(async(req,res)=>res.status(201).json({task:await query(req,'create',v.taskInput(req.body),req.user.sub)})))
router.get('/',asyncHandler(async(req,res)=>{v.pagination(req.query);res.json(await query(req,'list',req.user.sub,req.query))}))
router.get('/visible',asyncHandler(async(req,res)=>{v.pagination(req.query);res.json(await query(req,'visible',req.user.sub,req.query))}))
router.get('/:id',asyncHandler(async(req,res)=>{
  v.uuid(req.params.id)
  const task=await query(req,'read',req.params.id,req.user.sub)
  if(!task)throw v.taskError('not_found','Owned task not found.',404)
  res.json({task})
}))
router.patch('/:id',asyncHandler(async(req,res)=>{v.uuid(req.params.id);res.json({task:await query(req,'update',req.params.id,req.user.sub,v.taskInput(req.body,true))})}))
router.delete('/:id',asyncHandler(async(req,res)=>{v.uuid(req.params.id);await query(req,'remove',req.params.id,req.user.sub);res.status(204).end()}))
router.use((error,req,res,next)=>{
  if(error.status && ['invalid_request','not_found','assignee_not_eligible','task_storage_unavailable'].includes(error.code))return res.status(error.status).json({code:error.code,message:error.message,requestId:req.requestId})
  next(error)
})
module.exports=router
