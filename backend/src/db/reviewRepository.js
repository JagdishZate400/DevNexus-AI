const crypto = require('crypto')
const { sourceError } = require('../services/sourceArchive')
const projection = `r.id, r.project_id AS "projectId", r.file_id AS "fileId", r.source_sha256 AS "sourceHash",
  r.file_path AS "file", p.name AS project, r.provider, r.model, r.status, r.coverage, r.options,
  r.error_code AS "errorCode", r.created_at AS "createdAt", r.updated_at AS "updatedAt"`
async function writeReviewFindings(client, id, findings) {
  for (const [ordinal,f] of findings.entries()) await client.query(`INSERT INTO repository_review_findings(id,review_id,ordinal,severity,category,line,problem,explanation,improvement,code,suggested_code,finding_type)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[f.id,id,ordinal,f.severity,f.category,Number(f.line),f.problem,f.explanation,f.improvement,f.code,f.suggestedCode || '',f.findingType ?? null])
  await client.query("UPDATE repository_reviews SET status='Completed',coverage=jsonb_set(coverage,'{filesReviewed}','1'::jsonb),updated_at=now(),error_code=NULL WHERE id=$1",[id])
}
function createReviewRepository(pool) {
  async function read(id, ownerId) {
    const row = (await pool.query(`SELECT ${projection} FROM repository_reviews r JOIN source_projects p ON p.id=r.project_id WHERE r.id=$1 AND p.owner_id=$2`, [id,ownerId])).rows[0]
    if (!row) return null
    const findings = (await pool.query(`SELECT f.id, f.finding_type AS "findingType", f.severity, f.category, f.line::text AS line, f.problem, f.explanation, f.improvement, f.code, f.suggested_code AS "suggestedCode", f.status,
      r.file_path AS file FROM repository_review_findings f JOIN repository_reviews r ON r.id=f.review_id JOIN source_projects p ON p.id=r.project_id
      WHERE r.id=$1 AND p.owner_id=$2 ORDER BY f.ordinal`,[id,ownerId])).rows
    return { ...row, scope: row.file, findings, findingsCount: findings.length, repository: true }
  }
  return {
    read,
    async list(ownerId) {
      const rows = (await pool.query(`SELECT ${projection}, count(f.id)::int AS "findingsCount" FROM repository_reviews r JOIN source_projects p ON p.id=r.project_id
        LEFT JOIN repository_review_findings f ON f.review_id=r.id WHERE p.owner_id=$1 GROUP BY r.id,p.name ORDER BY r.created_at DESC LIMIT 100`,[ownerId])).rows
      return rows.map((r) => ({ ...r, scope:r.file, repository:true }))
    },
    async start(input, ownerId) {
      const id = crypto.randomUUID()
      const result = await pool.query(`INSERT INTO repository_reviews(id,project_id,file_id,source_sha256,file_path,provider,model,status,created_by,coverage,options)
        SELECT $1,p.id,f.id,$4,f.path,'gemini',$5,'In Progress',$3,$6::jsonb,$7::jsonb FROM source_projects p JOIN source_files f ON f.project_id=p.id
        WHERE p.id=$2 AND p.owner_id=$3 AND f.id=$8 AND f.sha256=$4 RETURNING id`,[id,input.projectId,ownerId,input.sourceHash,input.model,JSON.stringify(input.coverage),JSON.stringify(input.options),input.fileId])
      if (!result.rows.length) throw sourceError('not_found','Owned source file not found.',404)
      return id
    },
    async complete(id, ownerId, findings) {
      const client=await pool.connect()
      try {
        await client.query('BEGIN')
        const row=(await client.query(`SELECT r.id FROM repository_reviews r JOIN source_projects p ON p.id=r.project_id WHERE r.id=$1 AND p.owner_id=$2 AND r.status='In Progress' FOR UPDATE OF r`,[id,ownerId])).rows[0]
        if (!row) throw sourceError('not_found','Review not found.',404)
        await writeReviewFindings(client,id,findings)
        await client.query('COMMIT')
      } catch(err) { await client.query('ROLLBACK'); throw err } finally { client.release() }
      return read(id,ownerId)
    },
    async fail(id,ownerId,code) {
      await pool.query(`UPDATE repository_reviews r SET status='Failed',error_code=$3,updated_at=now()
        WHERE r.id=$1 AND r.project_id IN (SELECT id FROM source_projects WHERE owner_id=$2) AND r.status='In Progress'`,[id,ownerId,code])
    },
    async triage(id,findingId,ownerId,status) {
      const result=await pool.query(`UPDATE repository_review_findings f SET status=$4 FROM repository_reviews r,source_projects p
        WHERE f.review_id=r.id AND r.project_id=p.id AND p.owner_id=$3 AND r.id=$1 AND f.id=$2 RETURNING f.id`,[id,findingId,ownerId,status])
      if (!result.rows.length) throw sourceError('not_found','Finding not found.',404)
      return read(id,ownerId)
    },
    async getStats(ownerId) {
      const batchRes = await pool.query(
        `SELECT count(*)::int AS count FROM repository_review_batches WHERE owner_id = $1`,
        [ownerId]
      )
      const batchCount = batchRes.rows[0]?.count || 0

      const standaloneRes = await pool.query(
        `SELECT count(*)::int AS count
         FROM repository_reviews r
         JOIN source_projects p ON p.id = r.project_id
         WHERE p.owner_id = $1
           AND r.coverage->>'batchId' IS NULL
           AND NOT EXISTS (SELECT 1 FROM repository_review_batch_files f WHERE f.review_id = r.id)
           AND NOT EXISTS (
             SELECT 1 FROM repository_review_batch_files f
             JOIN repository_review_batches b ON b.id = f.batch_id
             WHERE f.file_id = r.file_id AND f.source_sha256 = r.source_sha256
               AND r.project_id = b.project_id AND r.created_by = b.owner_id
               AND r.created_at >= b.created_at AND r.created_at <= coalesce(b.updated_at, now())
           )`,
        [ownerId]
      )
      const standaloneCount = standaloneRes.rows[0]?.count || 0
      const totalReviews = batchCount + standaloneCount

      const batchFilesRes = await pool.query(
        `SELECT count(*)::int AS count
         FROM repository_review_batch_files f
         JOIN repository_review_batches b ON b.id = f.batch_id
         WHERE b.owner_id = $1 AND f.status = 'Reviewed'`,
        [ownerId]
      )
      const batchReviewedFiles = batchFilesRes.rows[0]?.count || 0

      const standaloneFilesRes = await pool.query(
        `SELECT count(*)::int AS count
         FROM repository_reviews r
         JOIN source_projects p ON p.id = r.project_id
         WHERE p.owner_id = $1
           AND r.status = 'Completed'
           AND r.coverage->>'batchId' IS NULL
           AND NOT EXISTS (SELECT 1 FROM repository_review_batch_files f WHERE f.review_id = r.id)
           AND NOT EXISTS (
             SELECT 1 FROM repository_review_batch_files f
             JOIN repository_review_batches b ON b.id = f.batch_id
             WHERE f.file_id = r.file_id AND f.source_sha256 = r.source_sha256
               AND r.project_id = b.project_id AND r.created_by = b.owner_id
               AND r.created_at >= b.created_at AND r.created_at <= coalesce(b.updated_at, now())
           )`,
        [ownerId]
      )
      const standaloneCompletedFiles = standaloneFilesRes.rows[0]?.count || 0
      const filesReviewed = batchReviewedFiles + standaloneCompletedFiles

      const findingsRes = await pool.query(
        `SELECT fi.status, count(*)::int AS count
         FROM repository_review_findings fi
         WHERE fi.review_id IN (
           SELECT f.review_id
           FROM repository_review_batch_files f
           JOIN repository_review_batches b ON b.id = f.batch_id
           WHERE b.owner_id = $1 AND f.status = 'Reviewed' AND f.review_id IS NOT NULL
           UNION
           SELECT r.id
           FROM repository_reviews r
           JOIN source_projects p ON p.id = r.project_id
           WHERE p.owner_id = $1
             AND r.status = 'Completed'
             AND r.coverage->>'batchId' IS NULL
             AND NOT EXISTS (SELECT 1 FROM repository_review_batch_files f WHERE f.review_id = r.id)
             AND NOT EXISTS (
               SELECT 1 FROM repository_review_batch_files f
               JOIN repository_review_batches b ON b.id = f.batch_id
               WHERE f.file_id = r.file_id AND f.source_sha256 = r.source_sha256
                 AND r.project_id = b.project_id AND r.created_by = b.owner_id
                 AND r.created_at >= b.created_at AND r.created_at <= coalesce(b.updated_at, now())
             )
         )
         GROUP BY fi.status`,
        [ownerId]
      )
      let openFindings = 0
      let resolvedFindings = 0
      let totalFindings = 0
      for (const row of findingsRes.rows) {
        const c = Number(row.count) || 0
        totalFindings += c
        if (row.status === 'Open') {
          openFindings += c
        } else {
          resolvedFindings += c
        }
      }

      const projectsRes = await pool.query(
        `SELECT count(DISTINCT project_id)::int AS count
         FROM (
           SELECT b.project_id FROM repository_review_batches b WHERE b.owner_id = $1
           UNION
           SELECT r.project_id
           FROM repository_reviews r
           JOIN source_projects p ON p.id = r.project_id
           WHERE p.owner_id = $1
             AND r.coverage->>'batchId' IS NULL
             AND NOT EXISTS (SELECT 1 FROM repository_review_batch_files f WHERE f.review_id = r.id)
             AND NOT EXISTS (
               SELECT 1 FROM repository_review_batch_files f
               JOIN repository_review_batches b ON b.id = f.batch_id
               WHERE f.file_id = r.file_id AND f.source_sha256 = r.source_sha256
                 AND r.project_id = b.project_id AND r.created_by = b.owner_id
                 AND r.created_at >= b.created_at AND r.created_at <= coalesce(b.updated_at, now())
             )
         ) sub`,
        [ownerId]
      )
      const projectsCount = projectsRes.rows[0]?.count || 0

      const thisMonthRes = await pool.query(
        `SELECT count(*)::int AS count
         FROM (
           SELECT created_at FROM repository_review_batches WHERE owner_id = $1
           UNION ALL
           SELECT r.created_at
           FROM repository_reviews r
           JOIN source_projects p ON p.id = r.project_id
           WHERE p.owner_id = $1
             AND r.coverage->>'batchId' IS NULL
             AND NOT EXISTS (SELECT 1 FROM repository_review_batch_files f WHERE f.review_id = r.id)
             AND NOT EXISTS (
               SELECT 1 FROM repository_review_batch_files f
               JOIN repository_review_batches b ON b.id = f.batch_id
               WHERE f.file_id = r.file_id AND f.source_sha256 = r.source_sha256
                 AND r.project_id = b.project_id AND r.created_by = b.owner_id
                 AND r.created_at >= b.created_at AND r.created_at <= coalesce(b.updated_at, now())
             )
         ) sub
         WHERE created_at >= date_trunc('month', now())`,
        [ownerId]
      )
      const recentThisMonth = thisMonthRes.rows[0]?.count || 0

      return {
        totalReviews,
        filesReviewed,
        openFindings,
        resolvedFindings,
        totalFindings,
        projectsCount,
        recentThisMonth,
      }
    },
  }
}
module.exports={createReviewRepository,writeReviewFindings}
