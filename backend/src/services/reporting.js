const {error}=require('./reportValidation')
async function reportsQuery(req,method,...args){
 try{
  const repository=req.app.locals.reportsRepository||require('../db/reportsRepository').createReportsRepository(require('../db/postgres'))
  return await repository[method](...args)
 }catch(err){
  if(err.code==='not_found'||err.code==='invalid_request')throw err
  throw error('reports_unavailable','Persisted reporting data is unavailable. Verify the existing database schema and connection.',503)
 }
}
module.exports={reportsQuery}
