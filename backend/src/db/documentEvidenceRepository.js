const crypto=require('crypto')
const {extractEvidence,evidencePath,sanitizeExample,LIMITS}=require('../services/documentEvidence')
const {scoreFileForOverview}=require('../services/documentOverviewSelection')
const {sourceError}=require('../services/sourceArchive')
const error=(code,status=400)=>sourceError(code,'Documentation evidence request could not be accepted.',status)
function prepareFiles(input) {
  if(!Array.isArray(input)||!input.length||input.length>LIMITS.files) throw error('invalid_request')
  let rawBytes=0
  const files=input.map(file=>{
    if(!file || Object.keys(file).some(k=>!['path','content'].includes(k)) || typeof file.content!=='string') throw error('invalid_request')
    const kind=evidencePath(file.path)
    if(kind==='source') throw error('unsupported_file')
    rawBytes+=Buffer.byteLength(file.content)
    if(Buffer.byteLength(file.content)>LIMITS.fileBytes||rawBytes>LIMITS.totalBytes) throw error('context_limit',413)
    const content=kind==='configuration-example'?sanitizeExample(file.content):file.content
    return {id:crypto.randomUUID(),path:file.path,content,kind,byteSize:Buffer.byteLength(content),sha256:crypto.createHash('sha256').update(content).digest('hex')}
  })
  extractEvidence(files)
  return files
}
function createDocumentEvidenceRepository(pool) {
  async function transaction(projectId,ownerId,run) {
    const c=await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SET LOCAL statement_timeout='10000ms'")
      if(!(await c.query('SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[projectId,ownerId])).rows.length) throw error('not_found',404)
      const result=await run(c)
      await c.query('COMMIT');return result
    } catch(e) {await c.query('ROLLBACK');throw e} finally {c.release()}
  }
  async function snapshot(projectId,ownerId) {
    return transaction(projectId,ownerId,async c=>{
      const bounds=(await c.query(`SELECT count(*)::int AS files,COALESCE(sum(byte_size),0)::int AS bytes,COALESCE(max(byte_size),0)::int AS largest
        FROM (SELECT byte_size FROM source_files WHERE project_id=$1 UNION ALL SELECT byte_size FROM project_document_evidence WHERE project_id=$1) evidence`,[projectId])).rows[0]
      if(!bounds || bounds.largest>LIMITS.fileBytes) throw error('context_limit',413)
      if(bounds.files<=LIMITS.files && bounds.bytes<=LIMITS.totalBytes) {
        const metadata=(await c.query('SELECT id,path,content,sha256 FROM project_document_evidence WHERE project_id=$1 ORDER BY path LIMIT 201',[projectId])).rows.map(f=>({...f,storageKind:'documentation-evidence'}))
        const source=(await c.query('SELECT id,path,content,sha256 FROM source_files WHERE project_id=$1 ORDER BY path LIMIT 201',[projectId])).rows.map(f=>({...f,storageKind:'source'}))
        const files=[...source,...metadata].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
        return {files,analysis:extractEvidence(files)}
      }
      const metadata=(await c.query('SELECT id,path,content,sha256,byte_size AS "byteSize" FROM project_document_evidence WHERE project_id=$1 ORDER BY path',[projectId])).rows.map(f=>({...f,storageKind:'documentation-evidence'}))
      const source=(await c.query('SELECT id,path,content,sha256,byte_size AS "byteSize",language FROM source_files WHERE project_id=$1 ORDER BY path',[projectId])).rows.map(f=>({...f,storageKind:'source'}))
      const candidates=[
        ...metadata.map(f=>{
          const leaf=f.path.split('/').at(-1).toLowerCase()
          const isDoc=/^(?:README|INSTALL|CONTRIBUTING)\.md$/i.test(leaf)
          const isManifest=['package.json','requirements.txt','pyproject.toml'].includes(leaf)
          const score=isDoc?1100:isManifest?1000:900
          return {...f,score}
        }),
        ...source.map(f=>{
          let score=scoreFileForOverview(f)
          const leaf=f.path.split('/').at(-1).toLowerCase()
          if(['package.json','requirements.txt','pyproject.toml'].includes(leaf)) score=950
          return {...f,score}
        })
      ]
      candidates.sort((a,b)=>{
        if(b.score!==a.score) return b.score-a.score
        const depthA=a.path.split('/').length, depthB=b.path.split('/').length
        if(depthA!==depthB) return depthA-depthB
        const pathDiff=a.path.localeCompare(b.path)
        if(pathDiff!==0) return pathDiff
        return a.id.localeCompare(b.id)
      })
      const BUDGET_FILES=25, BUDGET_BYTES=240000
      const selected=[]
      let totalBytes=0
      for(const candidate of candidates) {
        if(selected.length>=BUDGET_FILES) break
        const size=candidate.byteSize || Buffer.byteLength(candidate.content)
        if(totalBytes+size>BUDGET_BYTES) continue
        selected.push(candidate)
        totalBytes+=size
      }
      if(!selected.length) throw error('context_limit',413)
      selected.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
      return {files:selected,analysis:extractEvidence(selected)}
    })
  }
  return {
    // Internal only: raw content is for server validation, never an HTTP response/prompt.
    generationSnapshot:snapshot,
    async add(projectId,ownerId,input) {
      // No raw request is retained on disk or sent to a provider.
      return transaction(projectId,ownerId,async c=>{
        const files=prepareFiles(input)
        const existing=(await c.query('SELECT path,byte_size AS "byteSize" FROM project_document_evidence WHERE project_id=$1',[projectId])).rows
        const source=(await c.query('SELECT path,byte_size AS "byteSize" FROM source_files WHERE project_id=$1',[projectId])).rows
        const all=[...existing,...source,...files],paths=all.map(f=>f.path.toLowerCase()),seen=new Set(paths)
        if(existing.length+files.length>LIMITS.files || existing.reduce((s,f)=>s+f.byteSize,0)+files.reduce((s,f)=>s+f.byteSize,0)>LIMITS.totalBytes || all.length>200 || all.reduce((s,f)=>s+f.byteSize,0)>10*1024*1024) throw error('context_limit',413)
        if(seen.size!==paths.length || paths.some(p=>p.split('/').slice(0,-1).some((_,i,a)=>seen.has(a.slice(0,i+1).join('/'))))) throw error('path_conflict',409)
        for(const f of files) await c.query('INSERT INTO project_document_evidence(id,project_id,path,kind,content,byte_size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[f.id,projectId,f.path,f.kind,f.content,f.byteSize,f.sha256])
        return {files:files.map(({content,...f})=>f)}
      })
    },
    async evidence(projectId,ownerId) {
      return (await snapshot(projectId,ownerId)).analysis
    },
  }
}
module.exports={prepareFiles,createDocumentEvidenceRepository}
