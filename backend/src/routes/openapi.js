const {BUG_FOCUSES,SECURITY_FOCUSES,REVIEW_FOCUSES}=require('../services/reviewOptions')
// Minimal OpenAPI 3.0 spec covering the implemented surface. Served at
// GET /api/openapi.json so the frontend (and future SDKs) can introspect the
// API without an extra docs dependency.
const spec = {
  openapi: '3.0.0',
  info: {
    title: 'AI Software Engineering Assistant API',
    version: '0.2.0',
    description: 'Auth, projects, tasks, sprints, team, reviews, documents, AI chat, security, activity/reports.',
  },
  servers: [{ url: '/api' }],
  components: {
    schemas: {
      RepositoryReviewOptions: {
        type: 'object', additionalProperties: false,
        description: 'Optional server-allowlisted priorities. Bugs accepts bugs only, Security accepts security only, BugsAndSecurity accepts both; General/Maintainability allow no nonempty selections. Omitted/empty selections preserve broad analysis. Unknown IDs, duplicates and invalid types are rejected. Order is normalized for persistence/idempotency.',
        properties: {
          focus: { type: 'string', enum: REVIEW_FOCUSES, default: 'General' },
          analysisFocus: { type: 'object', additionalProperties: false, properties: {
            bugs: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', enum: Object.keys(BUG_FOCUSES) } },
            security: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', enum: Object.keys(SECURITY_FOCUSES) } },
          } },
        },
      },
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/repository-review-batches/preview': { get: { summary: 'Preview bounded owned project source discovery; no batch creation or Gemini call', parameters: [{ in: 'query', name: 'projectId', required: true, schema: { type: 'string', maxLength: 160 } }], responses: { 200: { description: 'Preliminary candidate/exclusion counts, file metadata, reasons and limits; no source content' }, 400: { description: 'Invalid project ID' }, 401: { description: 'Authentication required' }, 404: { description: 'No owned source project' }, 409: { description: 'Inconsistent or duplicate metadata' }, 413: { description: 'Discovery file/byte limits exceeded; no partial listing' }, 503: { description: 'Source storage unavailable' } } } },
    '/repository-review-batches': {
      get: { summary: 'List newest 100 owned selected-file and entire-project batches', responses: { 200: { description: 'Scope, coverage and finding counts; selected batches include manifests; full-project lists omit manifests and source evidence' }, 503: { description: 'D2.1 migration/storage unavailable' } } },
      post: { summary: 'Queue selected uploaded files or discover an entire owned project', requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [
        { type: 'object', additionalProperties: false, required: ['projectId','fileIds'], properties: { projectId: { type: 'string' }, scope: { enum: ['Selected Files'], default: 'Selected Files' }, fileIds: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, options: { $ref: '#/components/schemas/RepositoryReviewOptions' }, idempotencyKey: { type: 'string', maxLength: 100 } } },
        { type: 'object', additionalProperties: false, required: ['projectId','scope'], properties: { projectId: { type: 'string' }, scope: { enum: ['Entire Project'] }, options: { $ref: '#/components/schemas/RepositoryReviewOptions' }, idempotencyKey: { type: 'string', maxLength: 100 } } }
      ] } } } }, responses: { 202: { description: 'batchId and atomic durable manifest; eligible files Pending, known exclusions Skipped; matching idempotent replay returns original batch' }, 400: { description: 'Invalid selection, client snapshot fields or empty project' }, 404: { description: 'Project or selected file not owned' }, 409: { description: 'Source metadata conflict, changed selected source or idempotency mismatch' }, 413: { description: 'Discovery exceeds 200 files/10 MiB or selected source exceeds review limit' }, 429: { description: 'Request or owner active-batch limit' }, 503: { description: 'Storage or Gemini configuration unavailable' } } },
    },
    '/repository-review-batches/{id}': { get: { summary: 'Read owned batch manifest and results; full-project findings are paged summaries', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }, { in: 'query', name: 'findingOffset', schema: { type: 'integer', minimum: 0, maximum: 4000, default: 0 } }], responses: { 200: { description: 'Up to 200 manifest entries with skip reasons; full-project findingsPage has at most 50 summaries without source evidence; selected detail contract preserved' }, 404: { description: 'No owned batch' } } } },
    '/repository-reviews': {
      get: { summary: 'List owned persisted single-file repository review attempts', responses: { 200: { description: 'Newest 100 owned reviews' }, 503: { description: 'Review migration/storage unavailable' } } },
      post: { summary: 'Gemini review of one owned PostgreSQL source file', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['projectId','fileId'], properties: { projectId: { type: 'string' }, fileId: { type: 'string', format: 'uuid' }, options: { $ref: '#/components/schemas/RepositoryReviewOptions' } } } } } }, responses: { 201: { description: 'Persisted completed review; zero findings allowed' }, 400: { description: 'Invalid/unsupported source or request' }, 404: { description: 'No owned source' }, 409: { description: 'Source integrity failure' }, 413: { description: 'Source review size limit' }, 504: { description: 'Gemini timeout; Failed attempt persisted' } } },
    },
    '/repository-reviews/{id}': { get: { summary: 'Read owned persisted review and findings', parameters: [{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}], responses: { 200: { description: 'Review, coverage and findings' }, 404: { description: 'No owned review' } } } },
    '/repository-reviews/{id}/findings/{findingId}': { patch: { summary: 'Persist owned finding triage status', parameters: ['id','findingId'].map((name)=>({in:'path',name,required:true,schema:{type:'string'}})), requestBody: {required:true,content:{'application/json':{schema:{type:'object',required:['status'],properties:{status:{enum:['Open','Reviewed','False Positive','Fixed']}}}}}}, responses: { 200: { description: 'Updated review' }, 404: { description: 'No owned finding' } } } },
    '/workspace/projects/{id}/index': {
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      post: { summary: 'Idempotently index owned stored source', responses: { 200: { description: 'Real totalFiles, indexedFiles, excludedFiles, pendingFiles, chunkCount, processedFiles' }, 404: { description: 'No owned uploaded project' }, 503: { description: 'Index storage unavailable' } } },
      get: { summary: 'Read owned source index counts', responses: { 200: { description: 'Real index counts' }, 404: { description: 'No owned project' }, 503: { description: 'Index storage unavailable' } } },
    },
    '/workspace/projects/{id}/search': { get: {
      summary: 'Search owned source chunks using PostgreSQL full-text search',
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }, { in: 'query', name: 'q', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 } }, { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 } }],
      responses: { 200: { description: 'results: fileId, path, startLine/endLine, startColumn/endColumn, snippet, rank; returnedCount. Empty matches return []' }, 400: { description: 'Invalid query' }, 404: { description: 'No owned project' }, 503: { description: 'Index storage unavailable' } },
    } },
    '/workspace/projects': { get: { summary: 'List owned source workspaces and owned temporary projects', responses: { 200: { description: 'Owned projects' }, 503: { description: 'Source migration missing or storage unavailable' } } } },
    '/workspace/projects/{id}/upload': { post: {
      summary: 'Upload source-only ZIP to an owned project (additive, no overwrite)',
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } },
      responses: { 201: { description: 'Source stored; uploadedFiles, uploadedBytes, files' }, 400: { description: 'Invalid or unsafe archive' }, 401: { description: 'Authentication required' }, 404: { description: 'No owned project' }, 409: { description: 'Source path conflict' }, 413: { description: 'Size/count limit' }, 415: { description: 'ZIP content type required' }, 503: { description: 'Storage unavailable' } },
    } },
    '/workspace/projects/{id}/files': { get: { summary: 'List owned project source metadata', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Project and files, without content' }, 404: { description: 'No owned project' } } } },
    '/workspace/projects/{id}/files/{fileId}': { get: { summary: 'Read owned source file as JSON text', parameters: ['id', 'fileId'].map((name) => ({ in: 'path', name, required: true, schema: { type: 'string' } })), responses: { 200: { description: 'File metadata and content' }, 404: { description: 'No owned source file' } } } },
    '/health': { get: { summary: 'Liveness probe', security: [], responses: { 200: { description: 'ok' } } } },
    '/auth/register': { post: { summary: 'Register (requires verified email code)', responses: { 201: { description: 'created' } } } },
    '/auth/login': { post: { summary: 'Login', responses: { 200: { description: 'ok' } } } },
    '/auth/refresh': { post: { summary: 'Rotate refresh token', responses: { 200: { description: 'ok' } } } },
    '/auth/logout': { post: { summary: 'Logout (revokes refresh tokens)', responses: { 200: { description: 'ok' } } } },
    '/auth/request-code': { post: { summary: 'Request email verification code', responses: { 200: { description: 'ok' } } } },
    '/auth/verify-code': { post: { summary: 'Verify email code', responses: { 200: { description: 'ok' } } } },
    '/auth/forgot-password': { post: { summary: 'Request password reset', responses: { 200: { description: 'ok' } } } },
    '/auth/reset-password': { post: { summary: 'Reset password with token', responses: { 200: { description: 'ok' } } } },
    '/auth/change-password': { post: { summary: 'Change password (rotates credentials)', responses: { 200: { description: 'ok' } } } },
    '/auth/me': { get: { summary: 'Current user', responses: { 200: { description: 'ok' } } } },
    '/auth/users': { get: { summary: 'List users (Team Lead / Project Manager)', responses: { 200: { description: 'ok' } } } },
    '/auth/users/{id}/role': { patch: { summary: 'Change user role (leads, never self)', responses: { 200: { description: 'ok' } } } },
    '/projects': {
      get: { summary: 'List projects (search/status/sort/page/limit)', responses: { 200: { description: 'ok' } } },
      post: { summary: 'Create project', responses: { 201: { description: 'created' } } },
    },
    '/projects/{id}': {
      get: { summary: 'Get project', responses: { 200: { description: 'ok' } } },
      patch: { summary: 'Update project (owner or lead)', responses: { 200: { description: 'ok' } } },
      put: { summary: 'Replace project (owner or lead)', responses: { 200: { description: 'ok' } } },
      delete: { summary: 'Delete project (owner or lead)', responses: { 204: { description: 'deleted' } } },
    },
    '/tasks': {
      get: { summary: 'List tasks (filters + pagination)', responses: { 200: { description: 'ok' } } },
      post: { summary: 'Create task', responses: { 201: { description: 'created' } } },
    },
    '/project-tasks': {
      get: {summary:'List durable tasks for one currently owned PostgreSQL project',parameters:[{in:'query',name:'projectId',required:true,schema:{type:'string',maxLength:160}},{in:'query',name:'limit',schema:{type:'integer',minimum:1,maximum:50,default:20}},{in:'query',name:'offset',schema:{type:'integer',minimum:0,maximum:100000,default:0}}],responses:{200:{description:'{tasks,total,limit,offset}'},401:{description:'Authentication required'},404:{description:'Owned project not found'},503:{description:'Storage unavailable'}}},
      post: {summary:'Create durable owner-authorized task; no manager/assignee bypass',requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['projectId','title'],properties:{projectId:{type:'string',maxLength:160},title:{type:'string',minLength:1,maxLength:200},description:{type:'string',maxLength:2000,default:''},status:{type:'string',enum:['To Do','In Progress','Done'],default:'To Do'},priority:{type:'string',enum:['Low','Medium','High'],default:'Medium'},assigneeUserId:{type:'string',format:'uuid',nullable:true,description:'Current project owner or registered member; omitted/null creates unassigned'}}}}}},responses:{201:{description:'{task} including sprintId, assigneeUserId and nullable assignee {userId,displayName,email}'},400:{description:'Invalid request'},401:{description:'Authentication required'},404:{description:'Owned project not found'},503:{description:'Storage unavailable'}}},
    },
    '/project-tasks/{id}': {
      parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],
      get:{summary:'Read task only through current durable project ownership',responses:{200:{description:'{task}'},404:{description:'Owned task not found'}}},
      patch:{summary:'Update task fields and registered assignee; project/creator/sprint immutable',requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,minProperties:1,properties:{title:{type:'string',minLength:1,maxLength:200},description:{type:'string',maxLength:2000},status:{type:'string',enum:['To Do','In Progress','Done']},priority:{type:'string',enum:['Low','Medium','High']},assigneeUserId:{type:'string',format:'uuid',nullable:true,description:'Omitted preserves; UUID assigns owner/member; null clears. Invalid selection returns assignee_not_eligible without disclosing identity.'}}}}}},responses:{200:{description:'{task} including sprintId, assigneeUserId and nullable assignee {userId,displayName,email}'},400:{description:'Invalid request'},404:{description:'Owned task not found'}}},
      delete:{summary:'Delete task only through current durable project ownership',responses:{204:{description:'Deleted'},404:{description:'Owned task not found'}}},
    },
    '/tasks/{id}': {
      get: { summary: 'Get task', responses: { 200: { description: 'ok' } } },
      patch: { summary: 'Update task', responses: { 200: { description: 'ok' } } },
      delete: { summary: 'Delete task', responses: { 204: { description: 'deleted' } } },
    },
    '/sprints': {
      get: { summary: 'List sprints', responses: { 200: { description: 'ok' } } },
      post: { summary: 'Create sprint', responses: { 201: { description: 'created' } } },
    },
    '/sprints/{id}': {
      get: { summary: 'Get sprint', responses: { 200: { description: 'ok' } } },
      patch: { summary: 'Update sprint', responses: { 200: { description: 'ok' } } },
      delete: { summary: 'Delete sprint', responses: { 204: { description: 'deleted' } } },
    },
    '/sprints/{id}/activate': { post: { summary: 'Activate sprint (demotes others)', responses: { 200: { description: 'ok' } } } },
    '/sprints/{id}/complete': { post: { summary: 'Complete sprint', responses: { 200: { description: 'ok' } } } },
    '/team': { get: { summary: 'List members', responses: { 200: { description: 'ok' } } } },
    '/team/invite': { post: { summary: 'Invite member', responses: { 201: { description: 'created' } } } },
    '/team/{id}': {
      patch: { summary: 'Update member', responses: { 200: { description: 'ok' } } },
      delete: { summary: 'Remove member', responses: { 204: { description: 'deleted' } } },
    },
    '/reviews': {
      get: { summary: 'List code reviews', responses: { 200: { description: 'ok' } } },
      post: { summary: 'Start code review', responses: { 201: { description: 'created' } } },
    },
    '/reviews/analyze': { post: {
      summary: 'Gemini or deterministic JavaScript / TypeScript source review',
      description: 'Source is never executed or persisted. Gemini sends source to Google; deterministic mode uses local text rules. Returns up to 200 findings. Summary counts refer to returned findings; total includes omitted findings.',
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['code', 'language'], properties: {
          code: { type: 'string', minLength: 1, maxLength: 50000, description: 'Nonblank source code' },
          language: { type: 'string', enum: ['javascript', 'typescript'] },
          file: { type: 'string', minLength: 1, maxLength: 160, description: 'Display name only' },
            mode: { type: 'string', enum: ['gemini', 'deterministic'], description: 'Defaults to Gemini when AI_PROVIDER=gemini, otherwise deterministic' },
        },
      } } } },
      responses: {
        200: { description: 'provider=gemini or deterministic, language, file, findings (id, severity, line, category, status, problem, explanation, improvement, code, suggestedCode), summary, total, truncated' },
        400: { description: 'Invalid input' }, 401: { description: 'Authentication required' },
        413: { description: 'JSON body exceeds 100KB' }, 429: { description: 'Rate limit exceeded' },
      },
    } },
    '/reviews/{id}': {
      get: { summary: 'Get review', responses: { 200: { description: 'ok' } } },
      patch: { summary: 'Update review status', responses: { 200: { description: 'ok' } } },
      delete: { summary: 'Delete review', responses: { 204: { description: 'deleted' } } },
    },
    '/documents': {
      get: { summary: 'List documents', responses: { 200: { description: 'ok' } } },
    },
    '/documents/generate': { post: { summary: 'Generate document', responses: { 201: { description: 'created' } } } },
    '/documents/types': { get: { summary: 'Document types', responses: { 200: { description: 'ok' } } } },
    '/documents/{id}': {
      get: { summary: 'Get document', responses: { 200: { description: 'ok' } } },
      patch: { summary: 'Update document', responses: { 200: { description: 'ok' } } },
      delete: { summary: 'Delete document', responses: { 204: { description: 'deleted' } } },
    },
    '/ai/conversations': {
      get: { summary: 'List own conversations', responses: { 200: { description: 'ok' } } },
      post: { summary: 'Create conversation', responses: { 201: { description: 'created' } } },
    },
    '/ai/conversations/{id}': {
      get: { summary: 'Get conversation', responses: { 200: { description: 'ok' } } },
      delete: { summary: 'Delete conversation', responses: { 204: { description: 'deleted' } } },
    },
    '/ai/conversations/{id}/messages': { post: { summary: 'Send chat message', responses: { 201: { description: 'created' } } } },
    '/ai/ask': { post: { summary: 'Stateless ask (auto-creates conversation)', responses: { 201: { description: 'created' } } } },
    '/security/findings': { get: { summary: 'List findings', responses: { 200: { description: 'ok' } } } },
    '/security/audit': { get: { summary: 'Audit summary', responses: { 200: { description: 'ok' } } } },
    '/security/analyze': { post: { summary: 'Run analysis pass', responses: { 201: { description: 'created' } } } },
    '/activity': { get: { summary: 'Activity feed', responses: { 200: { description: 'ok' } } } },
    '/reports': {
      get: { summary: 'Retired legacy snapshot history', deprecated: true, responses: { 410: { description: 'Legacy snapshots retired; no records returned' }, 401: { description: 'Authentication required' } } },
    },
    '/reports/generate': { post: { summary: 'Retired snapshot generation', deprecated: true, responses: { 410: { description: 'Legacy snapshots retired; no mutation' }, 401: { description: 'Authentication required' } } } },
    '/reports/{id}': { patch: { summary: 'Retired snapshot archive', deprecated: true, parameters: [{name:'id',in:'path',required:true,schema:{type:'string'}}], responses: { 410: { description: 'Legacy snapshots retired; no mutation' }, 401: { description: 'Authentication required' } } } },
    '/reports/projects': { get: { summary: 'Owned persisted project identities only', responses: { 200: { description: '{projects:[{id,name}]} from PostgreSQL; no member or memory projects' }, 401: { description: 'Authentication required' }, 503: { description: 'Persisted reporting storage unavailable' } } } },
    '/reports/project': { get: { summary: 'Owner-only current-state project report', description: 'One read-only repeatable-read snapshot. Task completion and assigned-sprint completion are null for no tasks. File records include batch children once; batches are separate. Finding occurrences come from completed file records and retain historical severities.', parameters: [{name:'projectId',in:'query',required:true,schema:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,160}$'}}], responses: { 200: { description: '{project:{id,name},asOf,tasks:{total,toDo,inProgress,done,completionPercent},sprints:[{id,name,status,total,done,completionPercent}],reviews:{fileReviews:{total,byStatus},batches:{total,byStatus},findings:{total,bySeverity:[{severity,count,classification}]}}}' }, 400: { description: 'Invalid project query' }, 401: { description: 'Authentication required' }, 404: { description: 'Owned project not found; members and unrelated users denied' }, 503: { description: 'Persisted reporting storage unavailable; no fallback' } } } },
    '/reports/summary': { get: { summary: 'Dashboard-compatible owned-project aggregates', description: 'Preserves generatedAt/projects/tasks/sprints/team/reviews/documents/security keys. Reviews total counts Completed file records; documents total counts Completed documents. No global memory data.', responses: { 200: { description: 'Owner-scoped persisted counts' }, 401: { description: 'Authentication required' }, 503: { description: 'Persisted reporting storage unavailable' } } } },
    '/dashboard': { get: { summary: 'Dashboard payload', responses: { 200: { description: 'ok' } } } },
  },
}

function openapiHandler(req, res) {
  return res.json(spec)
}

module.exports = { openapiHandler, spec }
