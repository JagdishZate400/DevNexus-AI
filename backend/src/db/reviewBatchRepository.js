const { normalizeReviewOptions } = require('../services/reviewOptions')
const crypto = require('crypto')
const { sourceError } = require('../services/sourceArchive')
const { createReviewRepository, writeReviewFindings } = require('./reviewRepository')
const { readReviewDiscovery } = require('./sourceRepository')
const { prepareProjectManifest, describeReviewSkip } = require('../services/reviewDiscovery')
const { parseReviewScope, REVIEW_SCOPES, REVIEW_SCOPE_LIMITS } = require('../services/reviewScope')

const LEASE_SECONDS = 150 // Greater than Gemini's supported maximum 90-second deadline.
const MAX_ATTEMPTS = 2
const RETRY_SECONDS = 60
const CLAIM_LOCK = 1420136
const FINDINGS_PAGE_SIZE = 50
function coverage(files) {
  const result = { submitted: files.length, pending: 0, running: 0, reviewed: 0, skipped: 0, failed: 0 }
  for (const file of files) result[file.status.toLowerCase()]++
  return result
}
function aggregateStatus(counts) {
  if (counts.running) return 'In Progress'
  if (counts.pending) return 'Queued'
  if (counts.reviewed === counts.submitted && counts.submitted) return 'Completed'
  return counts.reviewed ? 'Partial' : 'Failed'
}
async function refresh(client) {
  await client.query(`UPDATE repository_review_batches b SET status=x.status,updated_at=now() FROM (
    SELECT batch_id, CASE WHEN count(*) FILTER(WHERE status='Running')>0 THEN 'In Progress'
      WHEN count(*) FILTER(WHERE status='Pending')>0 THEN 'Queued'
      WHEN count(*) FILTER(WHERE status='Reviewed')=count(*) THEN 'Completed'
      WHEN count(*) FILTER(WHERE status='Reviewed')>0 THEN 'Partial' ELSE 'Failed' END AS status
    FROM repository_review_batch_files GROUP BY batch_id) x WHERE b.id=x.batch_id AND b.status<>x.status`)
}
function createReviewBatchRepository(pool) {
  async function transaction(run, { readOnly = false } = {}) {
    const client = await pool.connect()
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN')
      await client.query("SET LOCAL statement_timeout='10000ms'")
      const value = await run(client)
      await client.query('COMMIT')
      return value
    } catch (err) { await client.query('ROLLBACK'); throw err } finally { client.release() }
  }
  async function read(id, ownerId, withFindings = true, findingOffset = 0) {
    return transaction(async (client) => {
      const row = (await client.query(`SELECT b.id,b.project_id AS "projectId",p.name AS project,b.scope,b.provider,b.model,b.status,b.options,
        b.created_at AS "createdAt",b.updated_at AS "updatedAt" FROM repository_review_batches b JOIN source_projects p ON p.id=b.project_id
        WHERE b.id=$1 AND b.owner_id=$2 AND p.owner_id=$2`, [id, ownerId])).rows[0]
      if (!row) return null
      const files = (await client.query(`SELECT f.file_id AS "fileId",f.path,f.source_sha256 AS "sourceHash",f.byte_count AS bytes,f.line_count AS lines,
        f.status,f.attempt_count AS attempts,f.error_code AS "errorCode",f.review_id AS "reviewId",f.started_at AS "startedAt",f.finished_at AS "finishedAt"
        FROM repository_review_batch_files f JOIN repository_review_batches b ON b.id=f.batch_id JOIN source_projects p ON p.id=b.project_id
        WHERE b.id=$1 AND b.owner_id=$2 AND p.owner_id=$2 ORDER BY f.ordinal LIMIT 201`, [id, ownerId])).rows
      if (files.length > 200) throw sourceError('source_metadata_conflict', 'Batch manifest exceeds its storage limits.', 409)
      if (row.scope === REVIEW_SCOPES.project) for (const file of files) file.skipReason = file.status === 'Skipped' ? { code: file.errorCode, message: describeReviewSkip(file.errorCode) } : null
      const findings = []
      let findingTotal = 0, findingsPage
      if (row.scope === REVIEW_SCOPES.project) {
        const join = `FROM repository_review_batch_files f JOIN repository_review_batches b ON b.id=f.batch_id
          JOIN source_projects p ON p.id=b.project_id JOIN repository_reviews r ON r.id=f.review_id AND r.project_id=b.project_id AND r.file_id=f.file_id AND r.source_sha256=f.source_sha256
          JOIN repository_review_findings fi ON fi.review_id=r.id
          WHERE b.id=$1 AND b.owner_id=$2 AND p.owner_id=$2 AND f.status='Reviewed' AND r.status='Completed'`
        findingTotal = (await client.query(`SELECT count(*)::int AS count ${join}`, [id, ownerId])).rows[0].count
        if (!Number.isInteger(findingOffset) || findingOffset < 0 || findingOffset > 4000) throw sourceError('invalid_request', 'Invalid finding offset.')
        if (withFindings) findings.push(...(await client.query(`SELECT fi.id,fi.finding_type AS "findingType",fi.severity,fi.category,fi.line::text AS line,fi.problem,fi.explanation,fi.improvement,fi.status,
          r.file_path AS file,r.id AS "reviewId",f.file_id AS "fileId",f.source_sha256 AS "sourceHash" ${join}
          ORDER BY f.ordinal,fi.ordinal LIMIT $3 OFFSET $4`, [id, ownerId, FINDINGS_PAGE_SIZE, findingOffset])).rows)
        const next = findingOffset + findings.length
        findingsPage = { offset: findingOffset, limit: FINDINGS_PAGE_SIZE, total: findingTotal, hasMore: next < findingTotal, nextOffset: next < findingTotal ? next : null }
      } else if (withFindings) for (const file of files) {
        if (file.status !== 'Reviewed' || !file.reviewId) continue
        const child = await createReviewRepository(client).read(file.reviewId, ownerId)
        if (child) findings.push(...child.findings.map((f) => ({ ...f, reviewId: child.id, fileId: file.fileId, sourceHash: file.sourceHash })))
      }
      const counts = coverage(files)
      return { ...row, status: aggregateStatus(counts), files, coverage: counts, findings, findingsCount: row.scope === REVIEW_SCOPES.project ? findingTotal : findings.length,
        ...(findingsPage ? { findingsPage } : {}), manifestIncluded: true, batch: true, repository: true }
    }, { readOnly: true })
  }
  return {
    read,
    async ready() { return !!(await pool.query("SELECT to_regclass('repository_review_batch_files') AS table_name")).rows[0]?.table_name },
    async list(ownerId) {
      // Polling history returns bounded metadata, not every finding's source evidence.
      const rows = (await pool.query(`SELECT b.id,b.project_id AS "projectId",p.name AS project,b.scope,b.provider,b.model,b.status,b.options,
        b.created_at AS "createdAt",b.updated_at AS "updatedAt",
        CASE WHEN b.scope='Selected Files' THEN (SELECT jsonb_agg(jsonb_build_object('fileId',f.file_id,'path',f.path,'sourceHash',f.source_sha256,'bytes',f.byte_count,'lines',f.line_count,
          'status',f.status,'attempts',f.attempt_count,'errorCode',f.error_code,'reviewId',f.review_id,'startedAt',f.started_at,'finishedAt',f.finished_at) ORDER BY f.ordinal)
          FROM repository_review_batch_files f WHERE f.batch_id=b.id) ELSE '[]'::jsonb END AS files,
        (
          SELECT coalesce(jsonb_agg(DISTINCT r_id), '[]'::jsonb)
          FROM (
            SELECT f.review_id AS r_id
            FROM repository_review_batch_files f
            WHERE f.batch_id = b.id AND f.review_id IS NOT NULL
            UNION
            SELECT r.id AS r_id
            FROM repository_reviews r
            WHERE r.coverage->>'batchId' = b.id::text
            UNION
            SELECT r.id AS r_id
            FROM repository_reviews r
            JOIN repository_review_batch_files f ON f.batch_id = b.id AND f.file_id = r.file_id AND f.source_sha256 = r.source_sha256
            WHERE r.project_id = b.project_id
              AND r.created_by = b.owner_id
              AND r.coverage->>'batchId' IS NULL
              AND r.created_at >= b.created_at
              AND r.created_at <= coalesce(b.updated_at, now())
          ) sub
          WHERE r_id IS NOT NULL
        ) AS "childReviewIds",
        (SELECT jsonb_build_object('submitted',count(*)::int,'pending',count(*) FILTER(WHERE f.status='Pending')::int,
          'running',count(*) FILTER(WHERE f.status='Running')::int,'reviewed',count(*) FILTER(WHERE f.status='Reviewed')::int,
          'skipped',count(*) FILTER(WHERE f.status='Skipped')::int,'failed',count(*) FILTER(WHERE f.status='Failed')::int)
          FROM repository_review_batch_files f WHERE f.batch_id=b.id) AS coverage,
        (SELECT count(*)::int FROM repository_review_batch_files f JOIN repository_review_findings fi ON fi.review_id=f.review_id
          JOIN repository_reviews r ON r.id=f.review_id WHERE f.batch_id=b.id AND f.status='Reviewed' AND r.status='Completed'
          AND r.project_id=b.project_id AND r.file_id=f.file_id AND r.source_sha256=f.source_sha256) AS "findingsCount"
        FROM repository_review_batches b JOIN source_projects p ON p.id=b.project_id
        WHERE b.owner_id=$1 AND p.owner_id=$1 ORDER BY b.created_at DESC LIMIT 100`, [ownerId])).rows
      return rows.map((row) => { const counts = row.coverage || coverage(row.files); return { ...row, status: aggregateStatus(counts), coverage: counts,
        manifestIncluded: row.scope !== REVIEW_SCOPES.project, batch: true, repository: true } })
    },
    async enqueue(input, ownerId) {
      const scope = parseReviewScope(input.scope)
      const options = normalizeReviewOptions(input.options)
      if (scope === REVIEW_SCOPES.project && Object.keys(input).some((key) => !['projectId', 'scope', 'options', 'model', 'idempotencyKey'].includes(key))) throw sourceError('invalid_request', 'Entire Project source discovery must be server-side.')
      if (scope === REVIEW_SCOPES.selected && (!Array.isArray(input.files) || !input.files.length || input.files.length > REVIEW_SCOPE_LIMITS[scope].maxFiles || new Set(input.files.map((f) => f.id.toLowerCase())).size !== input.files.length)) throw sourceError('invalid_request', 'Select one to three distinct uploaded files.')
      const id = await transaction(async (client) => {
        // Serialize submissions for this owner, including idempotent replay and queue bounds.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`review-batch:${ownerId}`])
        // Project lock also serializes against native uploads, which lock this same row.
        const owned = (await client.query(`SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 ${scope === REVIEW_SCOPES.project ? 'FOR UPDATE' : 'FOR SHARE'}`, [input.projectId, ownerId])).rows[0]
        if (!owned) throw sourceError('not_found', 'Owned source project not found.', 404)
        const existing = (await client.query('SELECT * FROM repository_review_batches WHERE owner_id=$1 AND idempotency_key=$2', [ownerId, input.idempotencyKey])).rows[0]
        if (existing) {
          if (existing.project_id !== input.projectId || existing.scope !== scope || JSON.stringify(normalizeReviewOptions(existing.options)) !== JSON.stringify(options)) throw sourceError('idempotency_conflict', 'This idempotency key belongs to different project, scope or review options.', 409)
          if (scope === REVIEW_SCOPES.selected) {
            const ids = (await client.query('SELECT file_id FROM repository_review_batch_files WHERE batch_id=$1 ORDER BY file_id', [existing.id])).rows.map((f) => f.file_id)
            if (JSON.stringify(ids) !== JSON.stringify(input.files.map((f) => f.id.toLowerCase()).sort())) throw sourceError('idempotency_conflict', 'This idempotency key belongs to a different selection.', 409)
          }
          return existing.id
        }
        const count = (await client.query("SELECT count(*)::int AS count FROM repository_review_batches WHERE owner_id=$1 AND status IN ('Queued','In Progress')", [ownerId])).rows[0].count
        if (count >= 2) throw sourceError('review_queue_full', 'At most two active batches are allowed per owner. Wait for an existing batch.', 429)
        let files
        if (scope === REVIEW_SCOPES.project) {
          const snapshot = await readReviewDiscovery(client, input.projectId, ownerId, { lockFiles: true })
          if (!snapshot) throw sourceError('not_found', 'Owned source project not found.', 404)
          files = prepareProjectManifest(snapshot, input.projectId).files
        } else files = input.files.map((file) => ({ ...file, status: 'Pending', errorCode: null }))
        const initialStatus = aggregateStatus(coverage(files))
        const id = crypto.randomUUID()
        await client.query(`INSERT INTO repository_review_batches(id,project_id,owner_id,options,scope,provider,model,status,idempotency_key)
          VALUES($1,$2,$3,$4::jsonb,$7::varchar(20),'gemini',$5,$8::varchar(20),$6)`, [id, input.projectId, ownerId, JSON.stringify(options), input.model, input.idempotencyKey, scope, initialStatus])
        for (const [ordinal, file] of files.entries()) {
          if (scope === REVIEW_SCOPES.selected) {
            const stored = (await client.query('SELECT id FROM source_files WHERE id=$1 AND project_id=$2 AND sha256=$3 AND path=$4 AND content=$5 FOR SHARE', [file.id, input.projectId, file.sourceHash, file.path, file.content])).rows[0]
            if (!stored) throw sourceError('source_changed', 'Source changed during submission. Select the files again.', 409)
          }
          await client.query(`INSERT INTO repository_review_batch_files(batch_id,file_id,path,source_sha256,byte_count,line_count,ordinal,status,error_code,finished_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8::varchar(20),$9,CASE WHEN $8::varchar(20)='Skipped' THEN now() ELSE NULL END)`, [id, file.id, file.path, file.sourceHash, file.bytes, file.lines, ordinal, file.status, file.errorCode])
        }
        return id
      })
      return read(id, ownerId)
    },
    async claim() {
      return transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [CLAIM_LOCK])
        // A crashed worker's child is never left looking successful. Every takeover gets a new token.
        await client.query(`UPDATE repository_reviews r SET status='Failed',error_code='worker_interrupted',updated_at=now()
          FROM repository_review_batch_files f WHERE f.review_id=r.id AND f.status='Running' AND f.lease_until<=now() AND r.status='In Progress'`)
        await client.query(`UPDATE repository_review_batch_files SET status=CASE WHEN attempt_count<$1 THEN 'Pending' ELSE 'Failed' END,
          error_code='worker_interrupted',claim_token=NULL,lease_until=NULL,available_at=now()+interval '60 seconds',updated_at=now(),
          finished_at=CASE WHEN attempt_count>=$1 THEN now() ELSE NULL END WHERE status='Running' AND lease_until<=now()`, [MAX_ATTEMPTS])
        await refresh(client)
        // One global batch-file request at a time across Express instances, at least 10s between starts.
        if ((await client.query("SELECT 1 FROM repository_review_batch_files WHERE status='Running' OR started_at>now()-interval '10 seconds' OR (error_code='ai_quota' AND available_at>now()) LIMIT 1")).rows.length) return null
        const row = (await client.query(`SELECT f.*,b.project_id AS "projectId",b.owner_id AS "ownerId",b.options,b.model
          FROM repository_review_batch_files f JOIN repository_review_batches b ON b.id=f.batch_id
          WHERE f.status='Pending' AND f.available_at<=now() AND f.attempt_count<$1
          ORDER BY b.created_at,f.ordinal FOR UPDATE OF f SKIP LOCKED LIMIT 1`, [MAX_ATTEMPTS])).rows[0]
        if (!row) return null
        const token = crypto.randomUUID()
        await client.query(`UPDATE repository_review_batch_files SET status='Running',attempt_count=attempt_count+1,claim_token=$3,
          lease_until=now()+($4 * interval '1 second'),started_at=now(),finished_at=NULL,updated_at=now()
          WHERE batch_id=$1 AND file_id=$2`, [row.batch_id, row.file_id, token, LEASE_SECONDS])
        await refresh(client)
        return { ...row, token, attempt: row.attempt_count + 1 }
      })
    },
    async attachReview(job) {
      return transaction(async (client) => {
        const held = (await client.query(`SELECT f.file_id FROM repository_review_batch_files f JOIN repository_review_batches b ON b.id=f.batch_id
          JOIN source_projects p ON p.id=b.project_id JOIN source_files s ON s.id=f.file_id AND s.project_id=p.id
          WHERE f.batch_id=$1 AND f.file_id=$2 AND f.claim_token=$3 AND f.lease_until>now() AND f.status='Running'
          AND p.owner_id=b.owner_id AND s.sha256=f.source_sha256 AND s.path=f.path FOR UPDATE OF f FOR SHARE OF p,s`, [job.batch_id, job.file_id, job.token])).rows[0]
        if (!held) return null
        const id = crypto.randomUUID()
        const metadata = { batchId: job.batch_id, scope: 'Single File', path: job.path, sourceHash: job.source_sha256, bytes: job.byte_count, lines: job.line_count, filesSubmitted: 1, filesReviewed: 0, truncated: false }
        await client.query(`INSERT INTO repository_reviews(id,project_id,file_id,source_sha256,file_path,provider,model,status,created_by,coverage,options)
          VALUES($1,$2,$3,$4,$5,'gemini',$6,'In Progress',$7,$8::jsonb,$9::jsonb)`, [id, job.projectId, job.file_id, job.source_sha256, job.path, job.model, job.ownerId, JSON.stringify(metadata), JSON.stringify(job.options)])
        // Renew immediately before the external request so slow source loading cannot consume its lease.
        await client.query("UPDATE repository_review_batch_files SET review_id=$3,lease_until=now()+($4 * interval '1 second') WHERE batch_id=$1 AND file_id=$2", [job.batch_id, job.file_id, id, LEASE_SECONDS])
        return id
      })
    },
    async finish(job, { findings, code, skipped = false, retry = false, content, retryAfterSeconds = RETRY_SECONDS } = {}) {
      return transaction(async (client) => {
        const held = (await client.query(`SELECT * FROM repository_review_batch_files WHERE batch_id=$1 AND file_id=$2
          AND claim_token=$3 AND lease_until>now() AND status='Running' FOR UPDATE`, [job.batch_id, job.file_id, job.token])).rows[0]
        if (!held) return false // Fencing: an expired worker cannot commit or overwrite its replacement.
        const valid = (await client.query(`SELECT s.id FROM source_files s JOIN source_projects p ON p.id=s.project_id
          WHERE s.id=$1 AND p.id=$2 AND p.owner_id=$3 AND s.sha256=$4 AND s.path=$5 AND ($6::text IS NULL OR s.content=$6) FOR SHARE OF s,p`, [job.file_id, job.projectId, job.ownerId, job.source_sha256, job.path, content ?? null])).rows[0]
        if (!valid) { findings = undefined; code = skipped && code ? code : 'source_changed_or_unavailable'; skipped = true; retry = false }
        const succeeded = Array.isArray(findings) && !!held.review_id
        if (succeeded) {
          await writeReviewFindings(client, held.review_id, findings)
        } else if (held.review_id) await client.query("UPDATE repository_reviews SET status='Failed',error_code=$2,updated_at=now() WHERE id=$1 AND status='In Progress'", [held.review_id, code || 'review_failed'])
        const state = succeeded ? 'Reviewed' : skipped ? 'Skipped' : retry && held.attempt_count < MAX_ATTEMPTS ? 'Pending' : 'Failed'
        await client.query(`UPDATE repository_review_batch_files SET status=$4::varchar(20),error_code=$5,claim_token=NULL,lease_until=NULL,
          available_at=now()+($6 * interval '1 second'),finished_at=CASE WHEN $4::varchar(20)='Pending' THEN NULL ELSE now() END,updated_at=now()
          WHERE batch_id=$1 AND file_id=$2 AND claim_token=$3`, [job.batch_id, job.file_id, job.token, state, succeeded ? null : code || 'review_failed', state === 'Pending' || code === 'ai_quota' ? Math.max(RETRY_SECONDS, Math.min(3600, Number(retryAfterSeconds) || RETRY_SECONDS)) : 0])
        await refresh(client)
        return true
      })
    },
  }
}
module.exports = { createReviewBatchRepository, coverage, aggregateStatus, LEASE_SECONDS, MAX_ATTEMPTS }
