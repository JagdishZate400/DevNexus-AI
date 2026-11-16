const crypto=require('crypto')
const {uuid}=require('../services/taskValidation')
// Requires an existing transaction. A savepoint makes nested failures/settings reversible.
async function withTaskActivity(client,{actorUserId,projectId,reason},run){
 actorUserId=uuid(actorUserId).toLowerCase()
 if(typeof projectId!=='string'||!['task_created','task_updated','sprint_link_changed','membership_removed','owner_changed'].includes(reason))throw Error('Invalid activity context')
 const savepoint='activity_'+crypto.randomBytes(8).toString('hex')
 await client.query(`SAVEPOINT ${savepoint}`)
 try{
  const previous=(await client.query("SELECT current_setting('devnexus.activity_context',true) AS context")).rows[0]?.context||''
  await client.query(`SELECT set_config('devnexus.activity_context',jsonb_build_object('v',1,'txid',txid_current()::text,
   'actorUserId',$1::uuid,'projectId',$2::text,'reason',$3::text,'correlationId',$4::uuid)::text,true)`,[actorUserId,projectId,reason,crypto.randomUUID()])
  const result=await run()
  await client.query("SELECT set_config('devnexus.activity_context',$1,true)",[previous])
  await client.query(`RELEASE SAVEPOINT ${savepoint}`)
  return result
 }catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);await client.query(`RELEASE SAVEPOINT ${savepoint}`);throw error}
}
module.exports={withTaskActivity}
