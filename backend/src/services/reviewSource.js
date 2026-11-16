const crypto = require('crypto')
const { validatePath, validateSourceContent, sourceError, CODE_REVIEW_LANGUAGES } = require('./sourceArchive')
const REVIEW_SOURCE_LIMITS = Object.freeze({ characters: 50000, bytes: 512 * 1024, lines: 10000 })

// Shared by D1 and batches. Never truncate or execute the database source.
function validateReviewSource(file) {
  validatePath(file.path)
  if (!CODE_REVIEW_LANGUAGES.includes(file.language)) throw sourceError('unsupported_file', 'Unsupported source language.')
  validateSourceContent(file.content)
  if (file.content.length > REVIEW_SOURCE_LIMITS.characters || Buffer.byteLength(file.content) > REVIEW_SOURCE_LIMITS.bytes) throw sourceError('source_limit', 'Single-file review supports at most 50,000 characters. Source will not be truncated.', 413)
  const hash = crypto.createHash('sha256').update(file.content).digest('hex')
  if (hash !== file.sha256) throw sourceError('source_integrity', 'Stored source hash does not match its contents.', 409)
  return { path: file.path, sourceHash: hash, bytes: Buffer.byteLength(file.content), lines: file.content ? file.content.split(/\r\n|\n|\r/).length : 0, truncated: false }
}
module.exports = { validateReviewSource, REVIEW_SOURCE_LIMITS }
