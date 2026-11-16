const { sourceError } = require('./sourceArchive')
const { STORAGE_IDS: TYPES, generationSupported } = require('./documentTypes')
const STATUSES = ['Draft', 'Pending', 'Running', 'Completed', 'Failed']
const LIMITS = { title: 200, characters: 50000, bytes: 80000, references: 200, page: 50 }
const invalid = () => sourceError('invalid_request', 'Invalid document request.', 400)
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) }
function keys(value, allowed) { if (!object(value) || Object.keys(value).some(k => !allowed.includes(k))) throw invalid() }
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) throw invalid()
  return value
}
function projectId(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw invalid(); return value }
function uuid(value) { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw invalid(); return value }
function markdown(value) { text(value, LIMITS.characters); if (Buffer.byteLength(value) > LIMITS.bytes) throw invalid(); return value }
function draft(input, update = false) {
  keys(input, update ? ['title', 'markdown'] : ['projectId', 'documentType', 'title', 'markdown'])
  if (!update) { projectId(input.projectId); if (!TYPES.includes(input.documentType)) throw invalid() }
  if (update && !Object.keys(input).length) throw invalid()
  if (!update || input.title !== undefined) text(input.title, LIMITS.title, true)
  if (input.markdown !== undefined) markdown(input.markdown)
  return update ? { ...input } : { ...input, markdown: input.markdown ?? '' }
}
function pagination(query) {
  keys(query, ['projectId', 'limit', 'offset'])
  projectId(query.projectId)
  function number(value, fallback, max) {
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw invalid()
    return Number(value)
  }
  const limit = number(query.limit, 20, LIMITS.page), offset = number(query.offset, 0, 100000)
  if (!limit) throw invalid()
  return { projectId: query.projectId, limit, offset }
}
function generation(input) {
  keys(input, ['projectId', 'documentType', 'title', 'provider', 'model', 'fileIds', 'evidenceFileIds', 'requestId'])
  if (input.requestId !== undefined) uuid(input.requestId)
  draft({ projectId: input.projectId, documentType: input.documentType, title: input.title })
  if (input.provider !== 'gemini') throw invalid()
  if (typeof input.model !== 'string' || !/^[a-zA-Z0-9._/-]{1,120}$/.test(input.model)) throw invalid()
  const metadata=input.evidenceFileIds ?? []
  if (!Array.isArray(metadata) || !Array.isArray(input.fileIds) || input.fileIds.length+metadata.length > LIMITS.references) throw invalid()
  if (!input.fileIds.length && !metadata.length) throw invalid()
  input.fileIds.forEach(uuid)
  metadata.forEach(uuid)
  if (new Set([...input.fileIds,...metadata].map(id => id.toLowerCase())).size !== input.fileIds.length+metadata.length) throw invalid()
  return input
}
function coverage(value, submitted) {
  keys(value, ['filesSubmitted', 'filesIncluded', 'filesSkipped', 'filesFailed', 'truncated'])
  for (const key of ['filesSubmitted', 'filesIncluded', 'filesSkipped', 'filesFailed']) if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > LIMITS.references) throw invalid()
  if (value.filesSubmitted !== submitted || value.filesIncluded + value.filesSkipped + value.filesFailed !== submitted || typeof value.truncated !== 'boolean') throw invalid()
  return value
}
const FAILURE_CODES = ['ai_timeout', 'ai_unavailable', 'ai_rate_limited', 'ai_quota', 'ai_authentication', 'ai_configuration', 'ai_model_unavailable', 'ai_invalid_response', 'ai_blocked', 'source_changed', 'generation_failed', 'worker_interrupted']
function generationRequest(input) {
  keys(input, ['projectId', 'documentType', 'requestId'])
  projectId(input.projectId)
  if (!generationSupported(input.documentType)) throw invalid()
  if (input.requestId !== undefined) uuid(input.requestId)
  return { projectId: input.projectId, documentType: input.documentType, ...(input.requestId ? { requestId: input.requestId.toLowerCase() } : {}) }
}
function citationReferences(references, citations) {
  if (!Array.isArray(citations) || citations.length > 60) throw invalid()
  const result = references.map(ref => ({ ...ref }))
  for (const citation of citations) {
    keys(citation, ['fileId', 'path', 'lineStart', 'lineEnd'])
    uuid(citation.fileId)
    const ref = result.find(ref => ref.fileId === citation.fileId && ref.path === citation.path)
    if (!ref || !Number.isInteger(citation.lineStart) || !Number.isInteger(citation.lineEnd) || citation.lineStart < 1 || citation.lineEnd < citation.lineStart || citation.lineEnd > 10000) throw invalid()
    ref.lineRanges ||= []
    if (!ref.lineRanges.some(range => range.lineStart === citation.lineStart && range.lineEnd === citation.lineEnd)) ref.lineRanges.push({ lineStart: citation.lineStart, lineEnd: citation.lineEnd })
  }
  return result
}
module.exports = { TYPES, STATUSES, LIMITS, invalid, uuid, draft, pagination, generation, coverage, markdown, FAILURE_CODES, generationRequest, citationReferences }
