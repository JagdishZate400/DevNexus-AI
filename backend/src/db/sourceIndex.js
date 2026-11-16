const { chunkFile, INDEX_VERSION } = require('../services/sourceChunks')
const { sourceError } = require('../services/sourceArchive')

async function indexOnClient(client, projectId, ownerId) {
  const files = (await client.query(`SELECT f.id, f.path, f.language, f.content, f.sha256, i.source_sha256, i.index_version
    FROM source_files f JOIN source_projects p ON p.id=f.project_id
    LEFT JOIN source_file_indexes i ON i.file_id=f.id WHERE p.id=$1 AND p.owner_id=$2 ORDER BY f.path`, [projectId, ownerId])).rows
  let processedFiles = 0
  for (const file of files) {
    if (file.source_sha256 === file.sha256 && file.index_version === INDEX_VERSION) continue
    let chunks = [], status = 'indexed'
    try { chunks = chunkFile(file) } catch { status = 'excluded' }
    await client.query('DELETE FROM source_chunks WHERE file_id=$1', [file.id])
    if (chunks.length) await client.query(`INSERT INTO source_chunks(file_id,ordinal,start_line,end_line,start_column,end_column,content)
      SELECT $1, ordinal, "startLine", "endLine", "startColumn", "endColumn", content
      FROM jsonb_to_recordset($2::jsonb) AS x(ordinal int,"startLine" int,"endLine" int,"startColumn" int,"endColumn" int,content text)`, [file.id, JSON.stringify(chunks)])
    await client.query(`INSERT INTO source_file_indexes(file_id,source_sha256,index_version,status) VALUES($1,$2,$3,$4)
      ON CONFLICT(file_id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,index_version=EXCLUDED.index_version,status=EXCLUDED.status,indexed_at=now()`, [file.id, file.sha256, INDEX_VERSION, status])
    processedFiles++
  }
  return { ...(await indexStats(client, projectId, ownerId)), processedFiles }
}

async function indexStats(client, projectId, ownerId) {
  const row = (await client.query(`SELECT count(*)::int AS "totalFiles",
    count(*) FILTER (WHERE i.file_id IS NOT NULL AND i.source_sha256=f.sha256 AND i.index_version=$3 AND i.status='indexed')::int AS "indexedFiles",
    count(*) FILTER (WHERE i.file_id IS NOT NULL AND i.source_sha256=f.sha256 AND i.index_version=$3 AND i.status='excluded')::int AS "excludedFiles",
    (SELECT count(*)::int FROM source_chunks c JOIN source_files sf ON sf.id=c.file_id JOIN source_file_indexes si ON si.file_id=sf.id
      WHERE sf.project_id=$1 AND si.source_sha256=sf.sha256 AND si.index_version=$3 AND si.status='indexed'
      AND EXISTS(SELECT 1 FROM source_projects sp WHERE sp.id=$1 AND sp.owner_id=$2)) AS "chunkCount"
    FROM source_files f JOIN source_projects p ON p.id=f.project_id LEFT JOIN source_file_indexes i ON i.file_id=f.id
    WHERE p.id=$1 AND p.owner_id=$2`, [projectId, ownerId, INDEX_VERSION])).rows[0]
  return { ...row, pendingFiles: row.totalFiles - row.indexedFiles - row.excludedFiles }
}

function indexMethods(pool) {
  const jobsRepo = require('./sourceIndexJobsRepository').createSourceIndexJobsRepository(pool)
  return {
    async indexProject(projectId, ownerId) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SET LOCAL statement_timeout = '60000ms'")
        const project = (await client.query('SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [projectId, ownerId])).rows[0]
        if (!project) throw sourceError('not_found', 'Uploaded source project not found.', 404)
        const stats = await indexOnClient(client, projectId, ownerId)
        await client.query('COMMIT')
        return stats
      } catch (err) { await client.query('ROLLBACK'); throw err } finally { client.release() }
    },
    async indexStats(projectId, ownerId) { return indexStats(pool, projectId, ownerId) },
    async getIndexingStatus(projectId, ownerId) {
      if (await jobsRepo.ready()) {
        return jobsRepo.getJobStatus(projectId, ownerId)
      }
      const stats = await indexStats(pool, projectId, ownerId)
      const total = stats.totalFiles || 0
      const indexed = stats.indexedFiles || 0
      const excluded = stats.excludedFiles || 0
      const processed = indexed + excluded
      const pending = stats.pendingFiles || 0
      return {
        projectId,
        jobId: null,
        status: pending === 0 ? 'completed' : 'pending',
        progress: {
          totalFiles: total,
          processedFiles: processed,
          indexedFiles: indexed,
          excludedFiles: excluded,
          pendingFiles: pending,
          failedFiles: 0,
          percent: total === 0 ? 100 : Math.min(100, Math.round((processed / total) * 100)),
          currentBatch: 0,
          totalBatches: Math.max(1, Math.ceil(total / 50)),
        },
        chunkCount: stats.chunkCount,
        errorCode: null,
        errorMessage: null,
        createdAt: null,
        updatedAt: null,
        completedAt: null,
      }
    },
    async enqueueIndexingJob(projectId, ownerId, options = {}) {
      if (await jobsRepo.ready()) {
        return jobsRepo.enqueueJob(projectId, ownerId, options)
      }
      return null
    },
    async searchSource(projectId, ownerId, query, limit) {
      return (await pool.query({ text: `SELECT c.id, f.id AS "fileId", f.path, f.language, c.start_line AS "startLine", c.end_line AS "endLine",
        c.start_column AS "startColumn", c.end_column AS "endColumn", c.content AS snippet,
        ts_rank_cd(c.search_vector, plainto_tsquery('simple', $3)) + (CASE WHEN length($3) >= 3 AND POSITION(LOWER($3) IN LOWER(f.path)) > 0 THEN 0.15 ELSE 0.0 END) AS rank
        FROM source_chunks c JOIN source_files f ON f.id=c.file_id JOIN source_projects p ON p.id=f.project_id
        JOIN source_file_indexes i ON i.file_id=f.id
        WHERE p.id=$1 AND p.owner_id=$2 AND i.status='indexed' AND i.source_sha256=f.sha256 AND i.index_version=$5
        AND (c.search_vector @@ plainto_tsquery('simple', $3) OR (length($3) >= 3 AND POSITION(LOWER($3) IN LOWER(f.path)) > 0))
        ORDER BY rank DESC, f.path, c.ordinal LIMIT $4`, values: [projectId, ownerId, query, limit, INDEX_VERSION], query_timeout: 10000 })).rows
    },
  }
}
module.exports = { indexMethods, indexOnClient, indexStats }
