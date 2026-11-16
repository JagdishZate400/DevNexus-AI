// Shared by durable task CRUD and sprint-task reads. Expose only directory fields.
function taskProjection(alias='project_tasks'){
 const fields=['id','project_id AS "projectId"','creator_id AS "creatorId"','title','description','status','priority','created_at AS "createdAt"','updated_at AS "updatedAt"','sprint_id AS "sprintId"','assignee_user_id AS "assigneeUserId"']
 return fields.map(field=>`${alias}.${field}`).join(',')+`,
 (SELECT json_build_object('userId',u.id,'displayName',u.full_name,'email',u.email)
  FROM users u WHERE u.id=${alias}.assignee_user_id) AS assignee`
}
module.exports={taskProjection}
