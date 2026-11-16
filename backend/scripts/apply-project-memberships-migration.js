const fs=require('fs')
const path=require('path')
async function applyProjectMembershipsMigration(pool){
  const client=await pool.connect()
  try{
    await client.query('SELECT 1')
    await client.query(fs.readFileSync(path.join(__dirname,'migrations/0148-project-memberships.sql'),'utf8'))
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
}
async function main(){
  require('../src/config')
  if(!process.env.DATABASE_URL)throw new Error('configuration')
  const {Pool}=require('pg')
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:35000})
  try{await applyProjectMembershipsMigration(pool);console.log('Migration 0148 applied: project membership directory ready. Private project access unchanged.')}
  finally{await pool.end()}
}
if(require.main===module)main().catch(error=>{
  const sqlstate=/^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : 'unavailable'
  console.error(`Membership migration failed (SQLSTATE: ${sqlstate}). Check connectivity, permissions, users and source workspace prerequisites and whether already applied. No credentials or raw errors logged.`)
  process.exitCode=1
})
module.exports={applyProjectMembershipsMigration}
