const { LIMITS, validatePath, sourceError, CODE_REVIEW_LANGUAGES, resolveLanguage } = require('./sourceArchive')
const { REVIEW_SOURCE_LIMITS } = require('./reviewSource')
const { REVIEW_SCOPES, REVIEW_SCOPE_LIMITS } = require('./reviewScope')

const DISCOVERY_LIMITS = Object.freeze({ files: REVIEW_SCOPE_LIMITS[REVIEW_SCOPES.project].maxFiles, totalBytes: 10 * 1024 * 1024 })
const reasons = Object.freeze({
  unsupported_file: 'Unsupported source file type or language.',
  source_bytes_limit: 'Source exceeds 512 KiB.',
  source_character_limit: 'Source exceeds 50,000 UTF-16 characters.',
  source_line_limit: 'Source exceeds 10,000 lines.',
  unsafe_path: 'Source path fails existing path safety validation.',
  sensitive_file: 'Source path identifies a sensitive file.',
  invalid_source_metadata: 'Source metadata is incomplete or invalid.',
})
function exclusion(file) {
  try { validatePath(file.path) } catch (err) { return ['unsupported_file', 'unsafe_path', 'sensitive_file'].includes(err.code) ? err.code : 'unsafe_path' }
  const resolved = resolveLanguage(file.path)
  if (!CODE_REVIEW_LANGUAGES.includes(file.language) || !CODE_REVIEW_LANGUAGES.includes(resolved)) return 'unsupported_file'
  if (!Number.isSafeInteger(file.byteSize) || file.byteSize < 0) return 'invalid_source_metadata'
  if (file.byteSize > REVIEW_SOURCE_LIMITS.bytes) return 'source_bytes_limit'
  if (!Number.isSafeInteger(file.characterCount) || file.characterCount < 0 || !Number.isSafeInteger(file.lineCount) || file.lineCount < 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 || '')) return 'invalid_source_metadata'
  if (file.characterCount > REVIEW_SOURCE_LIMITS.characters) return 'source_character_limit'
  if (file.lineCount > REVIEW_SOURCE_LIMITS.lines) return 'source_line_limit'
  return null
}
function compareFiles(a, b) {
  const pathOrder = Buffer.compare(Buffer.from(String(a.path || '').normalize('NFC')), Buffer.from(String(b.path || '').normalize('NFC')))
  return pathOrder || Buffer.compare(Buffer.from(a.id.toLowerCase()), Buffer.from(b.id.toLowerCase()))
}
async function discoverProjectReview({ projectId, ownerId, repository }) {
  if (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(projectId)) throw sourceError('invalid_project_id', 'Invalid project ID.')
  if (!ownerId) throw sourceError('unauthorized', 'Sign in to preview uploaded project source.', 401)
  const owned = await repository.findProject(projectId, ownerId)
  if (!owned) throw sourceError('not_found', 'Owned source project not found.', 404)
  const snapshot = await repository.discoverReviewFiles(projectId, ownerId)
  if (!snapshot) throw sourceError('not_found', 'Owned source project not found.', 404)
  return buildDiscoveryPreview(snapshot, projectId)
}
function buildDiscoveryPreview(snapshot, projectId) {
  const { totalFiles, totalBytes, files } = snapshot
  if (!Number.isSafeInteger(totalFiles) || !Number.isSafeInteger(totalBytes) || totalFiles < 0 || totalBytes < 0 || !Array.isArray(files)) throw sourceError('source_metadata_conflict', 'Source discovery metadata is inconsistent.', 409)
  if (totalFiles > DISCOVERY_LIMITS.files || files.length > DISCOVERY_LIMITS.files || totalBytes > DISCOVERY_LIMITS.totalBytes) throw sourceError('review_discovery_limit', 'Project exceeds 200 uploaded files or 10 MiB. No partial discovery is returned.', 413)
  if (files.length !== totalFiles || files.reduce((sum, f) => sum + f.byteSize, 0) !== totalBytes) throw sourceError('source_metadata_conflict', 'Source discovery metadata is inconsistent.', 409)
  const ids = new Set(), paths = new Set()
  for (const file of files) {
    if (typeof file.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(file.id)) throw sourceError('source_metadata_conflict', 'Invalid source file identity.', 409)
    const id = file.id.toLowerCase(), path = String(file.path || '').normalize('NFC').toLowerCase()
    if (ids.has(id) || paths.has(path)) throw sourceError('source_metadata_conflict', 'Source discovery contains duplicate file identities or paths.', 409)
    ids.add(id); paths.add(path)
  }
  const counts = new Map()
  const manifest = [...files].sort(compareFiles).map((file) => {
    const code = exclusion(file)
    if (code) counts.set(code, (counts.get(code) || 0) + 1)
    // Explicit allowlist: never spread repository rows into the response.
    return { fileId: file.id, path: typeof file.path === 'string' ? file.path : '[invalid path]', language: file.language,
      bytes: file.byteSize, characters: file.characterCount, lines: file.lineCount,
      eligibility: code ? 'Known Exclusion' : 'Eligible Candidate', skipReason: code ? { code, message: reasons[code] } : null }
  })
  const knownSkippedFileCount = [...counts.values()].reduce((sum, n) => sum + n, 0)
  return { projectId, totalDiscoveredFiles: totalFiles, totalSourceBytes: totalBytes,
    eligibleCandidateCount: totalFiles - knownSkippedFileCount, knownSkippedFileCount,
    eligibilityIsPreliminary: true, finalValidation: 'Content safety, source integrity and limits must be revalidated before Gemini analysis.',
    skipReasons: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count, message: reasons[code] })),
    limits: { discovery: DISCOVERY_LIMITS, review: REVIEW_SOURCE_LIMITS }, files: manifest }
}
function prepareProjectManifest(snapshot, projectId) {
  const preview = buildDiscoveryPreview(snapshot, projectId)
  if (!preview.totalDiscoveredFiles) throw sourceError('empty_source_project', 'Project has no uploaded source files.', 400)
  const records = new Map(snapshot.files.map((file) => [file.id, file]))
  const files = preview.files.map((entry) => {
    const record = records.get(entry.fileId)
    // Do not falsify persisted byte/line/hash metadata to fit the existing schema.
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > REVIEW_SOURCE_LIMITS.bytes ||
        !Number.isSafeInteger(entry.lines) || entry.lines < 0 || typeof record.sha256 !== 'string' || record.sha256.length !== 64) {
      throw sourceError('source_metadata_conflict', 'Source metadata cannot be represented safely by the existing manifest schema.', 409)
    }
    return { id: entry.fileId, path: entry.path, sourceHash: record.sha256, bytes: entry.bytes, lines: entry.lines,
      status: entry.skipReason ? 'Skipped' : 'Pending', errorCode: entry.skipReason?.code || null }
  })
  return { preview, files }
}
function describeReviewSkip(code) {
  return reasons[code] || ({ source_changed: 'Source changed since submission.', source_missing: 'Source file was deleted or is unavailable.',
    ownership_unavailable: 'Project ownership is no longer available.', source_changed_or_unavailable: 'Source changed or is no longer available.',
    source_integrity: 'Stored source does not match its hash.', sensitive_content: 'Source contains apparent secrets.',
    binary_file: 'Source content is not accepted as text.', source_limit: 'Source exceeds review limits.' })[code] || 'Source failed final review safety checks.'
}
module.exports = { discoverProjectReview, buildDiscoveryPreview, prepareProjectManifest, describeReviewSkip, DISCOVERY_LIMITS }
