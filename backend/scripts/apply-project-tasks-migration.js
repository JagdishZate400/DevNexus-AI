const fs=require('fs')
const path=require('path')
async function applyProjectTasksMigration(pool){
  const client=await pool.connect()
  try{
    await client.query('SELECT 1')
    await client.query(fs.readFileSync(path.join(__dirname,'migrations/0146-project-tasks.sql'),'utf8'))
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
}
async function main(){
  require('../src/config')
  if(!process.env.DATABASE_URL)throw new Error('configuration')
  const {Pool}=require('pg')
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:35000})
  try{await applyProjectTasksMigration(pool);console.log('Migration 0146 applied: durable project tasks ready. Legacy tasks unchanged.')}
  finally{await pool.end()}
}
if(require.main===module)main().catch(error=>{
  const sqlstate=/^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : 'unavailable'
  console.error(`Task migration failed (SQLSTATE: ${sqlstate}). Check connectivity, permissions, source workspace prerequisites and whether already applied. No credentials or raw errors logged.`)
  process.exitCode=1
})
module.exports={applyProjectTasksMigration}
