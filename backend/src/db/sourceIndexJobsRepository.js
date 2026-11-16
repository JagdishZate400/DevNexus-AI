const crypto = require('crypto')
const { chunkFile, INDEX_VERSION } = require('../services/sourceChunks')
const { indexStats } = require('./sourceIndex')
const { sourceError } = require('../services/sourceArchive')

const DEFAULT_BATCH_SIZE = 50
const DEFAULT_LEASE_SECONDS = 60
const MAX_ATTEMPTS = 3

function createSourceIndexJobsRepository(pool) {
  let isReady = null

  async function ready() {
    if (isReady !== null) return isReady
    try {
      const res = await pool.query("SELECT to_regclass('source_indexing_jobs') AS reg")
      isReady = Boolean(res.rows[0]?.reg)
      return isReady
    } catch {
      return false
    }
  }

  async function enqueueJob(projectId, ownerId, { batchSize = DEFAULT_BATCH_SIZE } = {}) {
    // 1. Verify project exists and belongs to ownerId
    const project = (await pool.query('SELECT id, owner_id FROM source_projects WHERE id = $1 AND owner_id = $2', [projectId, ownerId])).rows[0]
    if (!project) throw sourceError('not_found', 'Project not found.', 404)

    // 2. Count unindexed / pending files
    const unindexedCount = (await pool.query(
      `SELECT count(*)::int AS n
       FROM source_files f
       LEFT JOIN source_file_indexes i ON i.file_id = f.id
       WHERE f.project_id = $1
         AND (i.file_id IS NULL OR i.source_sha256 != f.sha256 OR i.index_version != $2)`,
      [projectId, INDEX_VERSION]
    )).rows[0]?.n || 0

    const totalFiles = (await pool.query(
      'SELECT count(*)::int AS n FROM source_files WHERE project_id = $1',
      [projectId]
    )).rows[0]?.n || 0

    const totalBatches = Math.max(1, Math.ceil(unindexedCount / batchSize))

    // 3. Check for existing active job (pending, retrying, processing)
    const existing = (await pool.query(
      `SELECT id, status, attempts FROM source_indexing_jobs
       WHERE project_id = $1 AND status IN ('pending', 'retrying', 'processing')
       ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    )).rows[0]

    if (existing) {
      if (existing.status === 'pending' || existing.status === 'retrying') {
        const updated = (await pool.query(
          `UPDATE source_indexing_jobs
           SET total_files = $2, total_batches = $3, batch_size = $4, status = 'pending', updated_at = now()
           WHERE id = $1 RETURNING *`,
          [existing.id, totalFiles, totalBatches, batchSize]
        )).rows[0]
        return updated
      }
      // If currently processing, worker will pick up remaining files in subsequent batches.
      return existing
    }

    // 4. Create new job
    const id = crypto.randomUUID()
    const status = unindexedCount === 0 ? 'completed' : 'pending'
    const completedAt = unindexedCount === 0 ? 'now()' : null

    const job = (await pool.query(
      `INSERT INTO source_indexing_jobs(
         id, project_id, status, total_files, processed_files,
         indexed_files, excluded_files, failed_files, current_batch,
         total_batches, batch_size, max_attempts, completed_at
       ) VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, $5, $6, $7, ${completedAt ? 'now()' : 'NULL'})
       RETURNING *`,
      [id, projectId, status, totalFiles, totalBatches, batchSize, MAX_ATTEMPTS]
    )).rows[0]

    return job
  }

  async function getJobStatus(projectId, ownerId) {
    const project = (await pool.query('SELECT id FROM source_projects WHERE id = $1 AND owner_id = $2', [projectId, ownerId])).rows[0]
    if (!project) throw sourceError('not_found', 'Project not found.', 404)

    const stats = await indexStats(pool, projectId, ownerId)
    const job = (await pool.query(
      `SELECT * FROM source_indexing_jobs
       WHERE project_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    )).rows[0]

    const totalFiles = stats.totalFiles
    const indexedFiles = stats.indexedFiles
    const excludedFiles = stats.excludedFiles
    const pendingFiles = stats.pendingFiles
    const processedFiles = indexedFiles + excludedFiles
    const percent = totalFiles === 0 ? 100 : Math.min(100, Math.round((processedFiles / totalFiles) * 100))

    let status = 'completed'
    if (pendingFiles > 0) {
      status = job?.status || 'pending'
    } else if (job && job.status === 'failed') {
      status = 'failed'
    }

    return {
      projectId,
      jobId: job?.id || null,
      status,
      progress: {
        totalFiles,
        processedFiles,
        indexedFiles,
        excludedFiles,
        pendingFiles,
        failedFiles: job?.failed_files || 0,
        percent,
        currentBatch: job?.current_batch || 0,
        totalBatches: job?.total_batches || Math.max(1, Math.ceil(totalFiles / DEFAULT_BATCH_SIZE)),
      },
      chunkCount: stats.chunkCount,
      errorCode: job?.error_code || null,
      errorMessage: job?.error_message || null,
      createdAt: job?.created_at || null,
      updatedAt: job?.updated_at || null,
      completedAt: job?.completed_at || null,
    }
  }

  async function claimJob(workerId, { leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const row = (await client.query(
        `SELECT id, project_id, batch_size, attempts, max_attempts
         FROM source_indexing_jobs
         WHERE (status = 'pending')
            OR (status IN ('retrying', 'processing') AND (lease_until IS NULL OR lease_until < now()))
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`
      )).rows[0]

      if (!row) {
        await client.query('COMMIT')
        return null
      }

      const updated = (await client.query(
        `UPDATE source_indexing_jobs
         SET status = 'processing',
             claim_token = $2,
             lease_until = now() + ($3 * interval '1 second'),
             attempts = attempts + 1,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [row.id, workerId, leaseSeconds]
      )).rows[0]

      await client.query('COMMIT')
      return updated
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async function renewLease(jobId, token, { leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
    const res = await pool.query(
      `UPDATE source_indexing_jobs
       SET lease_until = now() + ($3 * interval '1 second'), updated_at = now()
       WHERE id = $1 AND claim_token = $2 AND status = 'processing'`,
      [jobId, token, leaseSeconds]
    )
    return res.rowCount > 0
  }

  async function processBatch(job, token) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL statement_timeout = '60000ms'")

      // 1. Fencing check: verify job is still held with this token
      const held = (await client.query(
        `SELECT id, project_id, batch_size FROM source_indexing_jobs
         WHERE id = $1 AND claim_token = $2 AND status = 'processing' FOR UPDATE`,
        [job.id, token]
      )).rows[0]

      if (!held) {
        await client.query('ROLLBACK')
        return { held: false, hasMore: false }
      }

      // 2. Query batch of unindexed files
      const batchFiles = (await client.query(
        `SELECT f.id, f.path, f.language, f.content, f.sha256, i.source_sha256, i.index_version
         FROM source_files f
         LEFT JOIN source_file_indexes i ON i.file_id = f.id
         WHERE f.project_id = $1
           AND (i.file_id IS NULL OR i.source_sha256 != f.sha256 OR i.index_version != $2)
         ORDER BY f.path
         LIMIT $3`,
        [held.project_id, INDEX_VERSION, held.batch_size || DEFAULT_BATCH_SIZE]
      )).rows

      let indexedCount = 0
      let excludedCount = 0

      for (const file of batchFiles) {
        // Stale job fencing: verify file in database has not changed since queried
        const currentFile = (await client.query(
          'SELECT sha256 FROM source_files WHERE id = $1',
          [file.id]
        )).rows[0]

        if (!currentFile || currentFile.sha256 !== file.sha256) {
          // File was deleted or modified by newer upload; skip stale chunking
          continue
        }

        let chunks = []
        let status = 'indexed'
        try {
          chunks = chunkFile(file)
        } catch {
          status = 'excluded'
        }

        await client.query('DELETE FROM source_chunks WHERE file_id = $1', [file.id])

        if (chunks.length > 0) {
          await client.query(
            `INSERT INTO source_chunks(file_id, ordinal, start_line, end_line, start_column, end_column, content)
             SELECT $1, ordinal, "startLine", "endLine", "startColumn", "endColumn", content
             FROM jsonb_to_recordset($2::jsonb) AS x(ordinal int, "startLine" int, "endLine" int, "startColumn" int, "endColumn" int, content text)
             WHERE EXISTS (SELECT 1 FROM source_files sf WHERE sf.id = $1 AND sf.sha256 = $3)`,
            [file.id, JSON.stringify(chunks), file.sha256]
          )
        }

        await client.query(
          `INSERT INTO source_file_indexes(file_id, source_sha256, index_version, status, indexed_at)
           SELECT $1, $2, $3, $4, now()
           WHERE EXISTS (SELECT 1 FROM source_files sf WHERE sf.id = $1 AND sf.sha256 = $2)
           ON CONFLICT(file_id) DO UPDATE
             SET source_sha256 = EXCLUDED.source_sha256,
                 index_version = EXCLUDED.index_version,
                 status = EXCLUDED.status,
                 indexed_at = now()
             WHERE source_file_indexes.file_id = EXCLUDED.file_id
               AND EXISTS (SELECT 1 FROM source_files sf WHERE sf.id = EXCLUDED.file_id AND sf.sha256 = EXCLUDED.source_sha256)`,
          [file.id, file.sha256, INDEX_VERSION, status]
        )

        if (status === 'indexed') indexedCount++
        else excludedCount++
      }

      // 3. Count remaining unindexed files for this project
      const remaining = (await client.query(
        `SELECT count(*)::int AS n
         FROM source_files f
         LEFT JOIN source_file_indexes i ON i.file_id = f.id
         WHERE f.project_id = $1
           AND (i.file_id IS NULL OR i.source_sha256 != f.sha256 OR i.index_version != $2)`,
        [held.project_id, INDEX_VERSION]
      )).rows[0]?.n || 0

      const processedInBatch = indexedCount + excludedCount
      const isComplete = remaining === 0

      await client.query(
        `UPDATE source_indexing_jobs
         SET processed_files = processed_files + $2,
             indexed_files = indexed_files + $3,
             excluded_files = excluded_files + $4,
             current_batch = current_batch + 1,
             status = CASE WHEN $5 THEN 'completed' ELSE 'processing' END,
             completed_at = CASE WHEN $5 THEN now() ELSE NULL END,
             updated_at = now()
         WHERE id = $1`,
        [job.id, processedInBatch, indexedCount, excludedCount, isComplete]
      )

      await client.query('COMMIT')
      return {
        held: true,
        processedCount: processedInBatch,
        indexedCount,
        excludedCount,
        remaining,
        hasMore: !isComplete && batchFiles.length > 0,
        isComplete,
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async function failJob(jobId, token, { errorCode = 'indexing_failed', errorMessage = 'Indexing error', retryable = true } = {}) {
    const job = (await pool.query('SELECT attempts, max_attempts FROM source_indexing_jobs WHERE id = $1', [jobId])).rows[0]
    if (!job) return false

    const willRetry = retryable && job.attempts < job.max_attempts
    const nextStatus = willRetry ? 'retrying' : 'failed'
    const leaseUntil = willRetry ? "now() + interval '5 seconds'" : 'NULL'
    const completedAt = willRetry ? 'NULL' : 'now()'

    await pool.query(
      `UPDATE source_indexing_jobs
       SET status = $2,
           claim_token = NULL,
           lease_until = ${leaseUntil},
           completed_at = ${completedAt},
           error_code = $3,
           error_message = $4,
           failed_files = failed_files + 1,
           updated_at = now()
       WHERE id = $1 AND (claim_token = $5 OR claim_token IS NULL)`,
      [jobId, nextStatus, errorCode, String(errorMessage).slice(0, 500), token]
    )
    return willRetry
  }

  return {
    ready,
    enqueueJob,
    getJobStatus,
    claimJob,
    renewLease,
    processBatch,
    failJob,
  }
}

module.exports = {
  createSourceIndexJobsRepository,
  DEFAULT_BATCH_SIZE,
  DEFAULT_LEASE_SECONDS,
  MAX_ATTEMPTS,
}
