const crypto = require('crypto')
const { LIMITS, sourceError } = require('../services/sourceArchive')
const { indexMethods, indexOnClient } = require('./sourceIndex')
const { REVIEW_SOURCE_LIMITS } = require('../services/reviewSource')
const { REVIEW_SCOPES, REVIEW_SCOPE_LIMITS } = require('../services/reviewScope')
const { INDEX_VERSION } = require('../services/sourceChunks')

const metadata = 'id, path, language, byte_size AS "byteSize", sha256, uploaded_at AS "uploadedAt"'

async function readReviewDiscovery(client, id, ownerId, { lockFiles = false } = {}) {
  const maxFiles = REVIEW_SCOPE_LIMITS[REVIEW_SCOPES.project].maxFiles
  // At most 201 metadata rows are inspected even if external imports bypass upload caps.
  const row = (await client.query(`SELECT p.id,p.name,count(f.id) AS "totalFiles",COALESCE(sum(f.byte_size),0) AS "totalBytes"
    FROM source_projects p LEFT JOIN LATERAL (SELECT id,byte_size FROM source_files WHERE project_id=p.id LIMIT $3) f ON true
    WHERE p.id=$1 AND p.owner_id=$2 GROUP BY p.id,p.name`, [id, ownerId, maxFiles + 1])).rows[0]
  if (!row) return null
  const totalFiles = Number(row.totalFiles), totalBytes = Number(row.totalBytes)
  if (!Number.isSafeInteger(totalFiles) || !Number.isSafeInteger(totalBytes) || totalFiles > maxFiles || totalBytes > 10 * 1024 * 1024) {
    throw sourceError('review_discovery_limit', 'Project exceeds 200 uploaded files or 10 MiB. No partial discovery is returned.', 413)
  }
  // PostgreSQL computes bounded scalar metrics; source TEXT never reaches Node.
  // Count astral code points twice to match the existing JS UTF-16 character limit.
  const supplementaryPattern = `[^${String.fromCodePoint(0x10000)}-${String.fromCodePoint(0x10ffff)}]`
  const files = (await client.query(`SELECT f.id,f.path,f.language,f.sha256,f.byte_size AS "byteSize",
    CASE WHEN f.byte_size BETWEEN 0 AND $3 THEN char_length(f.content)+char_length(regexp_replace(f.content COLLATE "C",$4,'','g')) ELSE NULL END AS "characterCount",
    CASE WHEN f.byte_size BETWEEN 0 AND $3 THEN CASE WHEN f.content='' THEN 0 ELSE
      char_length(replace(replace(f.content,E'\\r\\n',E'\\n'),E'\\r',E'\\n'))-
      char_length(replace(replace(replace(f.content,E'\\r\\n',E'\\n'),E'\\r',E'\\n'),E'\\n',''))+1 END ELSE NULL END AS "lineCount"
    FROM source_files f JOIN source_projects p ON p.id=f.project_id
    WHERE p.id=$1 AND p.owner_id=$2 ORDER BY f.path COLLATE "C",f.id LIMIT $5${lockFiles ? ' FOR SHARE OF f' : ''}`,
  [id, ownerId, REVIEW_SOURCE_LIMITS.bytes, supplementaryPattern, maxFiles + 1])).rows
  return { project: { id: row.id, name: row.name }, totalFiles, totalBytes, files }
}

async function syncProjectFiles(client, project, ownerId, files, options = {}) {
  const { syncMode = 'merge', confirmed = false, asyncIndexing = false, batchSize = 50 } = options
  // 1. Lock project row for update (prevents concurrent uploads from interleaving)
  await client.query('INSERT INTO source_projects(id,owner_id,name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING', [project.id, ownerId, project.name])
  const locked = (await client.query('SELECT owner_id FROM source_projects WHERE id=$1 FOR UPDATE', [project.id])).rows[0]
  if (!locked || locked.owner_id !== ownerId) throw sourceError('not_found', 'Project not found.', 404)

  // 2. Fetch existing files
  const existingRows = (await client.query('SELECT id, path, language, byte_size AS "byteSize", sha256 FROM source_files WHERE project_id=$1', [project.id])).rows
  const existingByPath = new Map(existingRows.map((r) => [r.path.toLowerCase(), r]))

  // 3. Categorize incoming files
  const incomingMap = new Map()
  for (const f of files) {
    const key = f.path.toLowerCase()
    if (incomingMap.has(key)) {
      throw sourceError('duplicate_path', `Incoming archive contains duplicate path '${f.path}'.`, 400)
    }
    incomingMap.set(key, f)
  }

  const addedFiles = []
  const updatedFiles = []
  const unchangedFiles = []

  for (const file of files) {
    const key = file.path.toLowerCase()
    const existing = existingByPath.get(key)
    if (!existing) {
      addedFiles.push(file)
    } else if (existing.sha256 === file.sha256) {
      unchangedFiles.push({ ...file, id: existing.id })
    } else {
      updatedFiles.push({ ...file, id: existing.id })
    }
  }

  // 4. Missing files (existing files not present in incoming archive)
  const missingFiles = []
  for (const existing of existingRows) {
    if (!incomingMap.has(existing.path.toLowerCase())) {
      missingFiles.push(existing)
    }
  }

  // 5. Check protected files if delete_missing requested
  const isDeleteMissing = syncMode === 'delete_missing'
  if (isDeleteMissing && !confirmed) {
    throw sourceError('confirmation_required', 'Deleting missing files requires explicit confirmation (?confirmed=true). Preview changes first.', 400)
  }

  let removedFiles = []
  let preservedFiles = []

  if (isDeleteMissing && missingFiles.length > 0) {
    // Find any missing files that have historical review records
    const missingIds = missingFiles.map((f) => f.id)
    const reviewedRows = (await client.query(
      'SELECT DISTINCT file_id FROM repository_reviews WHERE file_id = ANY($1::uuid[])',
      [missingIds]
    )).rows
    const reviewedSet = new Set(reviewedRows.map((r) => r.file_id))

    for (const m of missingFiles) {
      if (reviewedSet.has(m.id)) {
        // Protected from deletion to preserve review history
        preservedFiles.push(m)
      } else {
        removedFiles.push(m)
      }
    }
  } else {
    // Default merge mode: all missing files are preserved
    preservedFiles = [...missingFiles]
  }

  // 6. Validate resulting project limits
  const resultingFilesCount = addedFiles.length + updatedFiles.length + unchangedFiles.length + preservedFiles.length
  const getByteSize = (f) => Number(f.byteSize ?? f.byte_size ?? 0)
  const resultingTotalBytes =
    addedFiles.reduce((sum, f) => sum + getByteSize(f), 0) +
    updatedFiles.reduce((sum, f) => sum + getByteSize(f), 0) +
    unchangedFiles.reduce((sum, f) => sum + getByteSize(f), 0) +
    preservedFiles.reduce((sum, f) => sum + getByteSize(f), 0)

  if (resultingFilesCount > LIMITS.files || resultingTotalBytes > LIMITS.totalBytes) {
    throw sourceError('project_limit', `Project source exceeds ${LIMITS.files} files or ${Math.round(LIMITS.totalBytes / (1024 * 1024))} MiB.`, 413)
  }

  // 7. Validate path hierarchy conflicts (e.g. file vs directory)
  const finalPaths = new Set([
    ...files.map((f) => f.path.toLowerCase()),
    ...preservedFiles.map((f) => f.path.toLowerCase()),
  ])
  for (const p of finalPaths) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/')
      if (finalPaths.has(parent)) {
        throw sourceError('path_conflict', `Path '${p}' conflicts with directory path '${parent}'. No files were saved.`, 409)
      }
    }
  }

  // 8. Execute Database Modifications
  // A. Delete prunable missing files (if delete_missing confirmed)
  if (removedFiles.length > 0) {
    const removeIds = removedFiles.map((f) => f.id)
    await client.query('DELETE FROM source_files WHERE id = ANY($1::uuid[])', [removeIds])
  }

  // B. Update modified files (preserves existing UUID id)
  for (const file of updatedFiles) {
    await client.query(
      'UPDATE source_files SET content = $1, byte_size = $2, sha256 = $3, language = $4, uploaded_at = now() WHERE id = $5',
      [file.content, file.byteSize, file.sha256, file.language, file.id]
    )
  }

  // C. Insert genuinely new files
  for (const file of addedFiles) {
    file.id = crypto.randomUUID()
    await client.query(
      'INSERT INTO source_files(id, project_id, path, language, content, byte_size, sha256) VALUES($1, $2, $3, $4, $5, $6, $7)',
      [file.id, project.id, file.path, file.language, file.content, file.byteSize, file.sha256]
    )
  }

  // D. Unchanged files require zero SQL updates

  // 9. Synchronize chunks & index
  const schema = (await client.query("SELECT to_regclass('source_chunks') AS chunks, to_regclass('source_file_indexes') AS indexes, to_regclass('source_indexing_jobs') AS jobs")).rows[0]
  let indexing = null
  if (options.asyncIndexing && schema?.jobs) {
    const unindexedCount = (await client.query(
      `SELECT count(*)::int AS n
       FROM source_files f
       LEFT JOIN source_file_indexes i ON i.file_id = f.id
       WHERE f.project_id = $1
         AND (i.file_id IS NULL OR i.source_sha256 != f.sha256 OR i.index_version != $2)`,
      [project.id, INDEX_VERSION]
    )).rows[0]?.n || 0

    const totalFiles = (await client.query(
      'SELECT count(*)::int AS n FROM source_files WHERE project_id = $1',
      [project.id]
    )).rows[0]?.n || 0

    const batchSize = options.batchSize || 50
    const totalBatches = Math.max(1, Math.ceil(unindexedCount / batchSize))
    const jobId = crypto.randomUUID()
    const jobStatus = unindexedCount === 0 ? 'completed' : 'pending'

    await client.query(
      `INSERT INTO source_indexing_jobs(
         id, project_id, status, total_files, processed_files,
         indexed_files, excluded_files, failed_files, current_batch,
         total_batches, batch_size, max_attempts, completed_at
       ) VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, $5, $6, 3, ${jobStatus === 'completed' ? 'now()' : 'NULL'})`,
      [jobId, project.id, jobStatus, totalFiles, totalBatches, batchSize]
    )

    indexing = {
      jobId,
      status: jobStatus,
      totalFiles,
      pendingFiles: unindexedCount,
      indexedFiles: totalFiles - unindexedCount,
      excludedFiles: 0,
      chunkCount: 0,
      async: true,
    }
  } else if (schema?.chunks && schema?.indexes) {
    indexing = await indexOnClient(client, project.id, ownerId)
  }

  const result = {
    summary: {
      added: addedFiles.length,
      updated: updatedFiles.length,
      unchanged: unchangedFiles.length,
      missing: missingFiles.length,
      removed: removedFiles.length,
      preserved: preservedFiles.length,
      totalIncoming: files.length,
      resultingFiles: resultingFilesCount,
      resultingBytes: resultingTotalBytes,
    },
    addedFiles: addedFiles.map((f) => f.path),
    updatedFiles: updatedFiles.map((f) => f.path),
    unchangedFiles: unchangedFiles.map((f) => f.path),
    removedFiles: removedFiles.map((f) => f.path),
    preservedFiles: preservedFiles.map((f) => f.path),
    indexing,
    length: files.length,
  }

  return result
}

async function previewSync(pool, project, ownerId, files, { syncMode = 'merge' } = {}) {
  const existingRows = (await pool.query(
    `SELECT id, path, language, byte_size AS "byteSize", sha256 FROM source_files WHERE project_id IN (SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2)`,
    [project.id, ownerId]
  )).rows
  const existingByPath = new Map(existingRows.map((r) => [r.path.toLowerCase(), r]))

  const addedFiles = []
  const updatedFiles = []
  const unchangedFiles = []

  for (const file of files) {
    const key = file.path.toLowerCase()
    const existing = existingByPath.get(key)
    if (!existing) addedFiles.push(file.path)
    else if (existing.sha256 === file.sha256) unchangedFiles.push(file.path)
    else updatedFiles.push(file.path)
  }

  const incomingMap = new Set(files.map((f) => f.path.toLowerCase()))
  const missingFiles = existingRows.filter((r) => !incomingMap.has(r.path.toLowerCase()))

  let protectedMissing = []
  let deletableMissing = []

  if (missingFiles.length > 0) {
    const missingIds = missingFiles.map((f) => f.id)
    const reviewedRows = (await pool.query(
      'SELECT DISTINCT file_id FROM repository_reviews WHERE file_id = ANY($1::uuid[])',
      [missingIds]
    )).rows
    const reviewedSet = new Set(reviewedRows.map((r) => r.file_id))
    for (const m of missingFiles) {
      if (reviewedSet.has(m.id)) protectedMissing.push(m.path)
      else deletableMissing.push(m.path)
    }
  }

  const isDeleteMissing = syncMode === 'delete_missing'
  const resultingFilesCount = files.length + (isDeleteMissing ? protectedMissing.length : missingFiles.length)

  return {
    projectId: project.id,
    syncMode,
    preview: true,
    added: addedFiles,
    updated: updatedFiles,
    unchanged: unchangedFiles,
    missing: missingFiles.map((f) => f.path),
    protectedMissing,
    deletableMissing,
    summary: {
      added: addedFiles.length,
      updated: updatedFiles.length,
      unchanged: unchangedFiles.length,
      missing: missingFiles.length,
      protected: protectedMissing.length,
      deletable: deletableMissing.length,
      totalIncoming: files.length,
      resultingFiles: resultingFilesCount,
    },
  }
}

function createSourceRepository(pool) {
  return {
    ...indexMethods(pool),
    async listProjects(ownerId) { return (await pool.query('SELECT id, name FROM source_projects WHERE owner_id = $1 ORDER BY name', [ownerId])).rows },
    async findProject(id, ownerId) { return (await pool.query('SELECT id, name FROM source_projects WHERE id = $1 AND owner_id = $2', [id, ownerId])).rows[0] || null },
    async listFiles(id, ownerId) {
      return (await pool.query(`SELECT ${metadata} FROM source_files WHERE project_id IN (SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2) ORDER BY path`, [id, ownerId])).rows
    },
    async discoverReviewFiles(id, ownerId) {
      const client = await pool.connect()
      try {
        // Count and metadata queries share one owner-authorized, read-only snapshot.
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        await client.query("SET LOCAL statement_timeout='10000ms'")
        const result = await readReviewDiscovery(client, id, ownerId)
        await client.query('COMMIT')
        return result
      } catch (err) { await client.query('ROLLBACK'); throw err } finally { client.release() }
    },
    async readFile(id, fileId, ownerId) {
      return (await pool.query(`SELECT ${metadata}, content FROM source_files WHERE project_id IN (SELECT id FROM source_projects WHERE id=$1 AND owner_id=$2) AND id=$3`, [id, ownerId, fileId])).rows[0] || null
    },
    async addFiles(project, ownerId, files, options = {}) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SET LOCAL statement_timeout = '60000ms'")
        const result = await syncProjectFiles(client, project, ownerId, files, options)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
    async previewSync(project, ownerId, files, options = {}) {
      return previewSync(pool, project, ownerId, files, options)
    },
    async removeProject(id, ownerId) {
      if (ownerId) {
        await pool.query('DELETE FROM source_projects WHERE id = $1 AND owner_id = $2', [id, ownerId])
      } else {
        await pool.query('DELETE FROM source_projects WHERE id = $1', [id])
      }
    },
  }
}

module.exports = { createSourceRepository, readReviewDiscovery, syncProjectFiles, previewSync }
