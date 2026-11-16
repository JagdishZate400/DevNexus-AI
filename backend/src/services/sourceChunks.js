const crypto = require('crypto')
const { validatePath, validateSourceContent, LIMITS } = require('./sourceArchive')
const INDEX_VERSION = 1
const MAX_CHUNK_BYTES = 8000
const MAX_CHUNK_LINES = 80

const SUPPORTED_LANGUAGES = Object.freeze([
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C',
  'C++',
  'C#',
  'Go',
  'Rust',
  'PHP',
  'HTML',
  'CSS',
  'JSON',
  'YAML',
  'SQL',
])

function chunkFile(file) {
  validatePath(file.path)
  if (!SUPPORTED_LANGUAGES.includes(file.language) || typeof file.content !== 'string' || Buffer.byteLength(file.content) > LIMITS.fileBytes) throw new Error('unsupported source')
  validateSourceContent(file.content)
  if (crypto.createHash('sha256').update(file.content).digest('hex') !== file.sha256) throw new Error('source integrity mismatch')
  const chunks = []
  let current = null
  function flush() {
    if (current) chunks.push({ ...current, ordinal: chunks.length })
    current = null
  }
  const lines = file.content.split(/\r\n|\n|\r/)
  lines.forEach((text, offset) => {
    const line = offset + 1
    const chars = Array.from(text)
    // Split unusually long lines without splitting Unicode code points.
    let column = 1, segment = '', bytes = 0
    const segments = []
    for (const char of chars) {
      const size = Buffer.byteLength(char)
      if (bytes + size > MAX_CHUNK_BYTES) { segments.push({ text: segment, column }); column += Array.from(segment).length; segment = ''; bytes = 0 }
      segment += char; bytes += size
    }
    segments.push({ text: segment, column })
    for (const part of segments) {
      const size = Buffer.byteLength(part.text)
      const canAppend = current && part.column === 1 && current.endLine < line && line - current.startLine < MAX_CHUNK_LINES && Buffer.byteLength(current.content) + size + 1 <= MAX_CHUNK_BYTES
      if (!canAppend) flush()
      if (!current) current = { startLine: line, endLine: line, startColumn: part.column, endColumn: Math.max(part.column, part.column + Array.from(part.text).length - 1), content: part.text }
      else { current.content += `\n${part.text}`; current.endLine = line; current.endColumn = Math.max(1, Array.from(part.text).length) }
    }
  })
  flush()
  // An empty source is still an indexed file, with no searchable chunks.
  return file.content.length ? chunks : []
}
module.exports = { chunkFile, INDEX_VERSION, MAX_CHUNK_BYTES, MAX_CHUNK_LINES, SUPPORTED_LANGUAGES }
