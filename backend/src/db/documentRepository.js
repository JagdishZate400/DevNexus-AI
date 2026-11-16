const crypto = require('crypto')
const v = require('../services/documentValidation')
const { sourceError } = require('../services/sourceArchive')
const columns = `d.id,d.project_id AS "projectId",d.creator_id AS "creatorId",d.document_type AS "documentType",d.title,
 d.generation_status AS "generationStatus",d.provider,d.model,d.source_references AS "sourceReferences",d.coverage,
 d.failure_code AS "failureCode",d.created_at AS "createdAt",d.updated_at AS "updatedAt"`
const missing = () => sourceError('not_found', 'Owned document or project not found.', 404)
const conflict = () => sourceError('document_state_conflict', 'Document state does not allow this operation.', 409)
function createDocumentRepository(pool) {
  async function transaction(run) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL statement_timeout='10000ms'")
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (err) { await client.query('ROLLBACK'); throw err }
    finally { client.release() }
  }
  async function owned(client, projectId, ownerId) {
    const row = (await client.query('SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR SHARE', [projectId, ownerId])).rows[0]
    if (!row) throw missing()
  }
  async function projectLock(client, projectId, ownerId) {
    // Same lock order for generation and recovery across all API instances.
    const row = (await client.query('SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [projectId,ownerId])).rows[0]
    if (!row) throw missing()
  }
  async function recover(client, projectId) {
    // Never restart the same document. State guards fence late provider completion.
    // 10 minutes exceeds the 90s provider budget plus bounded source/storage work.
    return (await client.query(`UPDATE project_documents SET generation_status='Failed',failure_code='worker_interrupted',updated_at=now()
      WHERE project_id=$1 AND generation_status IN ('Pending','Running') AND updated_at < now()-interval '10 minutes' RETURNING id`,[projectId])).rows
  }
  async function requestRecord(client, input, ownerId) {
    if (!input.requestId) return null
    const ready = (await client.query("SELECT to_regclass('public.project_document_requests') AS requests")).rows[0]?.requests
    if (!ready) throw sourceError('document_requests_unavailable','Generation request storage requires migration 0157.',503)
    // Serialize keys even when two requests target different projects.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ownerId}:${input.requestId}`])
    const saved = (await client.query('SELECT project_id,document_type,document_id FROM project_document_requests WHERE owner_id=$1 AND request_id=$2',[ownerId,input.requestId])).rows[0]
    if (!saved) return null
    if (saved.project_id !== input.projectId || saved.document_type !== input.documentType) throw sourceError('document_request_conflict','Request key was already used for different inputs.',409)
    if (!saved.document_id) throw sourceError('document_request_conflict','The original document is no longer available. Use a new request key.',409)
    return saved.document_id
  }
  async function read(id, ownerId) {
    v.uuid(id)
    return (await pool.query(`SELECT ${columns},d.markdown FROM project_documents d JOIN source_projects p ON p.id=d.project_id WHERE d.id=$1 AND p.owner_id=$2`, [id, ownerId])).rows[0] || null
  }
  async function insert(client, input, ownerId, generationStatus, references = []) {
    const id = crypto.randomUUID()
    const coverage = { filesSubmitted: references.length, filesIncluded: 0, filesSkipped: 0, filesFailed: 0, truncated: false }
    // Pending coverage describes the manifest, not successful generation.
    await client.query(`INSERT INTO project_documents(id,project_id,creator_id,document_type,title,markdown,generation_status,provider,model,source_references,coverage)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,
    [id,input.projectId,ownerId,input.documentType,input.title,input.markdown || '',generationStatus,input.provider || null,input.model || null,JSON.stringify(references),JSON.stringify(coverage)])
    return id
  }
  async function lockDocument(client, id, ownerId, states) {
    const scope = (await client.query('SELECT d.project_id AS "projectId" FROM project_documents d JOIN source_projects p ON p.id=d.project_id WHERE d.id=$1 AND p.owner_id=$2',[id,ownerId])).rows[0]
    if (!scope) throw missing()
    await projectLock(client,scope.projectId,ownerId)
    const row = (await client.query(`SELECT d.id,d.generation_status AS "generationStatus",d.source_references AS "sourceReferences",d.project_id AS "projectId",
      (d.updated_at >= now()-interval '10 minutes') AS "generationLive"
      FROM project_documents d JOIN source_projects p ON p.id=d.project_id WHERE d.id=$1 AND p.owner_id=$2 FOR UPDATE OF d FOR SHARE OF p`, [id,ownerId])).rows[0]
    if (!row) throw missing()
    if (!states.includes(row.generationStatus)) throw conflict()
    if (states.length===1 && ['Pending','Running'].includes(states[0]) && row.generationLive===false) throw conflict()
    return row
  }
  return {
    read,
    async replayGeneration(input, ownerId) {
      if (!input.requestId) return null
      return transaction(async client => {
        const id = await requestRecord(client,input,ownerId)
        await projectLock(client,input.projectId,ownerId)
        await recover(client,input.projectId)
        return id ? (await client.query(`SELECT ${columns},d.markdown FROM project_documents d JOIN source_projects p ON p.id=d.project_id WHERE d.id=$1 AND p.owner_id=$2`,[id,ownerId])).rows[0] || null : null
      })
    },
    async recoverAbandoned(projectId, ownerId) {
      return transaction(async client => { await projectLock(client,projectId,ownerId); return { recovered: (await recover(client,projectId)).length } })
    },
    async create(input, ownerId) {
      input = v.draft(input)
      const id = await transaction(async client => { await owned(client,input.projectId,ownerId); return insert(client,input,ownerId,'Draft') })
      return read(id,ownerId)
    },
    async list(ownerId, input) {
      const { projectId,limit,offset } = v.pagination(input)
      return transaction(async client => {
        await owned(client,projectId,ownerId)
        const total = Number((await client.query('SELECT count(*) AS total FROM project_documents WHERE project_id=$1',[projectId])).rows[0].total)
        const documents = (await client.query(`SELECT ${columns} FROM project_documents d JOIN source_projects p ON p.id=d.project_id
          WHERE d.project_id=$1 AND p.owner_id=$2 ORDER BY d.created_at DESC,d.id DESC LIMIT $3 OFFSET $4`,[projectId,ownerId,limit,offset])).rows
        return { documents,total,limit,offset }
      })
    },
    async update(id, ownerId, input) {
      v.uuid(id); input = v.draft(input,true)
      await transaction(async client => {
        await lockDocument(client,id,ownerId,['Draft'])
        await client.query('UPDATE project_documents SET title=COALESCE($2,title),markdown=COALESCE($3,markdown),updated_at=now() WHERE id=$1',[id,input.title ?? null,input.markdown ?? null])
      })
      return read(id,ownerId)
    },
    async remove(id, ownerId) {
      v.uuid(id)
      await transaction(async client => {
        await lockDocument(client,id,ownerId,['Draft','Completed','Failed'])
        await client.query('DELETE FROM project_documents WHERE id=$1',[id])
      })
    },
    // Internal only: authoritative metadata snapshots, no content loading or AI calls.
    async prepareGeneration(input, ownerId) {
      input = v.generation(input)
      const id = await transaction(async client => {
        const replayId = await requestRecord(client,input,ownerId)
        await projectLock(client,input.projectId,ownerId)
        await recover(client,input.projectId)
        if (replayId) return { id: replayId, replay: true }
        const active = (await client.query("SELECT id FROM project_documents WHERE project_id=$1 AND generation_status IN ('Pending','Running') LIMIT 1",[input.projectId])).rows[0]
        if (active) throw sourceError('document_generation_active','A generation is already active for this project.',409)
        let references = input.fileIds.length ? (await client.query(`SELECT id AS "fileId",path,sha256 AS hash,byte_size AS "byteSize" FROM source_files
          WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY path COLLATE "C",id FOR SHARE`,[input.projectId,input.fileIds])).rows
          : []
        if (references.length !== input.fileIds.length) throw missing()
        if (input.evidenceFileIds !== undefined) {
          references=references.map(ref=>({...ref,kind:'source'}))
          const metadata=input.evidenceFileIds.length ? (await client.query(`SELECT id AS "fileId",path,sha256 AS hash,byte_size AS "byteSize" FROM project_document_evidence
            WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY path COLLATE "C",id FOR SHARE`,[input.projectId,input.evidenceFileIds])).rows : []
          if(metadata.length!==input.evidenceFileIds.length) throw missing()
          references.push(...metadata.map(ref=>({...ref,kind:'documentation-evidence'})))
        }
        const documentId = await insert(client,input,ownerId,'Pending',references)
        if (input.requestId) await client.query('INSERT INTO project_document_requests(owner_id,request_id,project_id,document_type,document_id) VALUES($1,$2,$3,$4,$5)',[ownerId,input.requestId,input.projectId,input.documentType,documentId])
        return { id: documentId, replay: false }
      })
      const document = await read(id.id,ownerId)
      return document && { ...document, generationReplay: id.replay }
    },
    async startGeneration(id, ownerId) {
      v.uuid(id)
      await transaction(async client => {
        await lockDocument(client,id,ownerId,['Pending'])
        await client.query("UPDATE project_documents SET generation_status='Running',updated_at=now() WHERE id=$1",[id])
      })
      return read(id,ownerId)
    },
    async completeGeneration(id, ownerId, markdown, coverage, citations = []) {
      v.uuid(id); v.markdown(markdown)
      await transaction(async client => {
        const row = await lockDocument(client,id,ownerId,['Running'])
        v.coverage(coverage,row.sourceReferences.length)
        const references = v.citationReferences(row.sourceReferences,citations)
        // Refuse stale-source completion; caller can explicitly fail with source_changed.
        const fullSnapshot=row.sourceReferences.some(ref=>ref.kind!==undefined)
        const sourceIds = row.sourceReferences.filter(r=>r.kind==='source'||!r.kind).map(r=>r.fileId)
        const evidenceIds = row.sourceReferences.filter(r=>r.kind==='documentation-evidence').map(r=>r.fileId)
        const current = fullSnapshot ? [
          ...(sourceIds.length ? (await client.query('SELECT id AS "fileId",path,sha256 AS hash FROM source_files WHERE project_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[row.projectId,sourceIds])).rows.map(ref=>({...ref,kind:'source'})) : []),
          ...(evidenceIds.length ? (await client.query('SELECT id AS "fileId",path,sha256 AS hash FROM project_document_evidence WHERE project_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[row.projectId,evidenceIds])).rows.map(ref=>({...ref,kind:'documentation-evidence'})) : []),
        ] : (await client.query('SELECT id AS "fileId",path,sha256 AS hash FROM source_files WHERE project_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[row.projectId,row.sourceReferences.map(ref=>ref.fileId)])).rows
        if (current.length !== row.sourceReferences.length || row.sourceReferences.some(ref=>!current.some(file=>file.fileId===ref.fileId && file.hash===ref.hash && file.path===ref.path && (!fullSnapshot || file.kind===ref.kind)))) throw sourceError('source_changed','Document source changed during generation.',409)
        await client.query("UPDATE project_documents SET generation_status='Completed',markdown=$2,coverage=$3::jsonb,source_references=$4::jsonb,updated_at=now() WHERE id=$1",[id,markdown,JSON.stringify(coverage),JSON.stringify(references)])
      })
      return read(id,ownerId)
    },
    async failGeneration(id, ownerId, code) {
      v.uuid(id); if (!v.FAILURE_CODES.includes(code)) throw v.invalid()
      await transaction(async client => {
        await lockDocument(client,id,ownerId,['Pending','Running'])
        await client.query("UPDATE project_documents SET generation_status='Failed',failure_code=$2,updated_at=now() WHERE id=$1",[id,code])
      })
      return read(id,ownerId)
    },
  }
}
module.exports = { createDocumentRepository }
