// Used only by the explicit Team collaboration read endpoints. Never by writes,
// source workspace, AI, sprint, document, comment or activity repositories.
async function teamReadAccess(client,projectId,userId,missing){
 const project=(await client.query('SELECT id,owner_id AS "ownerId" FROM source_projects WHERE id=$1 FOR SHARE',[projectId])).rows[0]
 if(!project)throw missing()
 if(project.ownerId!==userId && !(await client.query('SELECT id FROM project_memberships WHERE project_id=$1 AND user_id=$2 FOR SHARE',[projectId,userId])).rows.length)throw missing()
 return project
}
module.exports={teamReadAccess}
