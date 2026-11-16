const yauzl = require('yauzl')
const crypto = require('crypto')
const fs = require('fs')
const { TextDecoder } = require('util')
const config = require('../config')

const LIMITS = Object.freeze({
  archiveBytes: Number(config.workspaceMaxArchiveBytes) || 50 * 1024 * 1024,
  fileBytes: Number(config.workspaceMaxFileBytes) || 1024 * 1024,
  totalBytes: Number(config.workspaceMaxTotalBytes) || 250 * 1024 * 1024,
  files: Number(config.workspaceMaxProjectFiles) || 1000,
  entries: Number(config.workspaceMaxEntries) || 10000,
  lines: Number(config.workspaceMaxLines) || 25000,
  ratio: Number(config.workspaceMaxExpansionRatio) || 25,
  timeoutMs: Number(config.workspaceExtractionTimeoutMs) || 60000,
})

function sourceError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status })
}

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

const CODE_REVIEW_LANGUAGES = Object.freeze([
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
  'SQL',
])

const LANGUAGE_EXTENSIONS = Object.freeze({
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.py': 'Python',
  '.pyw': 'Python',
  '.java': 'Java',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.hh': 'C++',
  '.hxx': 'C++',
  '.cs': 'C#',
  '.go': 'Go',
  '.rs': 'Rust',
  '.php': 'PHP',
  '.phtml': 'PHP',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.sass': 'CSS',
  '.less': 'CSS',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.sql': 'SQL',
})

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'vendor',
  'packages',
  'pods',
  'bower_components',
  '.git',
  '.svn',
  '.hg',
  '.venv',
  'venv',
  'env',
  '.conda',
  '__pycache__',
  '.pytest_cache',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '.eclipse',
  '__macosx',
])

const EXCLUDED_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.pyc', '.o', '.obj', '.wasm',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.mp4', '.mp3', '.wav', '.pdf',
  '.zip', '.tar', '.gz', '.7z', '.rar', '.bz2',
  '.md', '.markdown', '.txt', '.doc', '.docx', '.map', '.lock', '.log',
])

function resolveLanguage(filePath) {
  if (typeof filePath !== 'string') return null
  const match = filePath.toLowerCase().match(/\.[a-z0-9]+$/i)
  if (!match) return null
  return LANGUAGE_EXTENSIONS[match[0]] || null
}

function isSecretFile(name) {
  const parts = name.split('/')
  for (const p of parts) {
    const leaf = p.toLowerCase()
    if (leaf === '.env' || leaf.startsWith('.env.')) return true
    if (/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials|secrets)(?:\.|$)/i.test(leaf)) return true
    if (/\.(?:pem|key|p12|pfx)$/i.test(leaf)) return true
  }
  return false
}

function assertSafePath(name, directory = false) {
  if (typeof name !== 'string' || name.length > 240 || name.normalize('NFC') !== name) {
    throw sourceError('unsafe_path', 'Archive contains an unsafe path.')
  }
  if (/[\\:\x00-\x1f\x7f<>"|?*\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufffd]/.test(name) || name.startsWith('/')) {
    throw sourceError('unsafe_path', 'Archive contains an unsafe path.')
  }
  const parts = (directory ? name.slice(0, -1) : name).split('/')
  if (parts.length > 20) {
    throw sourceError('unsafe_path', 'Path nesting exceeds maximum allowed depth.')
  }
  for (const p of parts) {
    if (!p || p === '.' || p === '..') {
      throw sourceError('unsafe_path', 'Archive contains relative or empty path segments.')
    }
    if (/[. ]$/.test(p)) {
      throw sourceError('unsafe_path', 'Path segment contains trailing dot or space.')
    }
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) {
      throw sourceError('unsafe_path', 'Archive contains reserved Windows device name.')
    }
  }
}

function validatePath(name, directory = false) {
  assertSafePath(name, directory)
  const parts = (directory ? name.slice(0, -1) : name).split('/')
  if (parts.some((p) => p.startsWith('.') || /^(?:node_modules|__MACOSX)$/i.test(p))) {
    throw sourceError('unsafe_path', 'Archive contains a sensitive or unsupported path.')
  }
  if (isSecretFile(name)) {
    throw sourceError('sensitive_file', 'Archive contains sensitive files.')
  }
  const leaf = parts.at(-1)
  if (!directory && !resolveLanguage(leaf)) {
    throw sourceError('unsupported_file', 'Only supported source files are accepted.')
  }
  return name
}

function shouldSkipEntry(fileName) {
  const parts = fileName.split('/')
  for (let i = 0; i < parts.length - 1; i++) {
    if (EXCLUDED_DIRS.has(parts[i].toLowerCase())) return true
  }
  const leaf = parts[parts.length - 1]
  if (leaf.startsWith('.')) return true
  const extMatch = leaf.toLowerCase().match(/\.[a-z0-9]+$/i)
  if (extMatch && EXCLUDED_EXTENSIONS.has(extMatch[0])) return true
  if (!resolveLanguage(leaf)) return true
  return false
}

function validateSourceContent(content) {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) {
    throw sourceError('binary_file', 'Binary files are not accepted.')
  }
  if (content.split(/\r\n|\n|\r/).length > LIMITS.lines) {
    throw sourceError('source_limit', `Source file exceeds ${LIMITS.lines.toLocaleString()} lines.`, 413)
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[\w-]{35}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/.test(content) ||
      /(?:api[_-]?key|password|secret|access[_-]?token|private[_-]?key)\s*["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i.test(content)) {
    throw sourceError('sensitive_content', 'Source contains apparent credentials or private keys. Remove secrets before uploading.')
  }
}

// ZIP CRC verification, independent of archive metadata size checks.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function extractSource(input) {
  if (!input || (!Buffer.isBuffer(input) && typeof input !== 'string')) {
    return Promise.reject(sourceError('invalid_zip', 'A ZIP archive is required.'))
  }
  if (Buffer.isBuffer(input)) {
    if (!input.length) return Promise.reject(sourceError('invalid_zip', 'A ZIP archive is required.'))
    if (input.length > LIMITS.archiveBytes) return Promise.reject(sourceError('archive_limit', `ZIP archive exceeds ${Math.round(LIMITS.archiveBytes / (1024 * 1024))} MiB.`, 413))
  }
  if (typeof input === 'string') {
    let stat
    try {
      stat = fs.statSync(input)
    } catch {
      return Promise.reject(sourceError('invalid_zip', 'ZIP archive is invalid or damaged.'))
    }
    if (!stat.size) return Promise.reject(sourceError('invalid_zip', 'A ZIP archive is required.'))
    if (stat.size > LIMITS.archiveBytes) return Promise.reject(sourceError('archive_limit', `ZIP archive exceeds ${Math.round(LIMITS.archiveBytes / (1024 * 1024))} MiB.`, 413))
  }

  return new Promise((resolve, reject) => {
    let zip, stream, finished = false, count = 0, total = 0, totalCompressed = 0
    const files = [], paths = new Map()
    const finish = (err) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (stream) stream.destroy()
      if (zip) zip.close()
      if (err) reject(err.code && err.status ? err : sourceError('invalid_zip', 'ZIP archive is invalid or damaged.'))
      else if (!files.length) reject(sourceError('empty_archive', 'ZIP contains no accepted source files.'))
      else {
        const filePaths = new Set(files.map((f) => f.path.toLowerCase()))
        if (files.some((f) => f.path.toLowerCase().split('/').slice(0, -1).some((_, i, parts) => filePaths.has(parts.slice(0, i + 1).join('/'))))) {
          reject(sourceError('path_conflict', 'Archive contains conflicting file and directory paths.'))
        } else resolve(files)
      }
    }
    const timer = setTimeout(() => finish(sourceError('archive_timeout', 'Archive validation timed out.', 408)), LIMITS.timeoutMs)

    const onZipOpened = (err, opened) => {
      if (err) return finish(err)
      zip = opened
      if (finished) { zip.close(); return }
      if (zip.entryCount > LIMITS.entries) return finish(sourceError('file_limit', 'ZIP contains too many entries.', 413))
      zip.on('error', finish)
      zip.on('end', () => finish())
      zip.on('entry', (entry) => {
        try {
          if (++count > LIMITS.entries) throw sourceError('file_limit', 'ZIP contains too many entries.', 413)
          const directory = entry.fileName.endsWith('/')
          assertSafePath(entry.fileName, directory)
          if (isSecretFile(entry.fileName)) {
            throw sourceError('sensitive_file', 'Archive contains sensitive files.')
          }
          const type = (entry.externalFileAttributes >>> 16) & 0xf000
          if (type && type !== (directory ? 0x4000 : 0x8000)) {
            throw sourceError('unsafe_entry', 'Symlinks and special files are not accepted.')
          }
          if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod)) {
            throw sourceError('unsafe_entry', 'Encrypted or unsupported ZIP entries are not accepted.')
          }
          if (directory) {
            if (entry.uncompressedSize !== 0) throw sourceError('unsafe_entry', 'Directory entries must be empty.')
            zip.readEntry()
            return
          }
          if (shouldSkipEntry(entry.fileName)) {
            zip.readEntry()
            return
          }
          const path = validatePath(entry.fileName, false)
          const key = path.toLowerCase()
          if (paths.has(key)) throw sourceError('duplicate_path', 'ZIP contains duplicate paths.')
          paths.set(key, directory)

          if (files.length >= LIMITS.files || entry.uncompressedSize > LIMITS.fileBytes || total + entry.uncompressedSize > LIMITS.totalBytes) {
            throw sourceError('source_limit', 'Source exceeds file count or uncompressed size limits.', 413)
          }

          if (entry.compressedSize > 0 && entry.uncompressedSize > 250 * 1024 && (entry.uncompressedSize / entry.compressedSize) > LIMITS.ratio) {
            throw sourceError('decompression_bomb', 'Decompression bomb detected. Expansion ratio exceeds allowed limit.', 413)
          }

          zip.openReadStream(entry, (error, openedStream) => {
            if (error) return finish(error)
            stream = openedStream
            if (finished) { stream.destroy(); return }
            const chunks = []
            let size = 0
            stream.on('error', finish)
            stream.on('data', (chunk) => {
              size += chunk.length
              if (size > LIMITS.fileBytes || total + size > LIMITS.totalBytes) {
                return finish(sourceError('source_limit', 'Source exceeds uncompressed size limits.', 413))
              }
              chunks.push(chunk)
            })
            stream.on('end', () => {
              if (finished) return
              try {
                const bytes = Buffer.concat(chunks)
                if (size !== entry.uncompressedSize || crc32(bytes) !== entry.crc32) {
                  throw sourceError('invalid_zip', 'ZIP archive is invalid or damaged.')
                }
                totalCompressed += entry.compressedSize || size
                total += size
                if (total > 1024 * 1024 && (total / Math.max(1, totalCompressed)) > LIMITS.ratio) {
                  throw sourceError('decompression_bomb', 'Decompression bomb detected. Expansion ratio exceeds allowed limit.', 413)
                }
                let content
                try {
                  content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
                } catch {
                  throw sourceError('binary_file', 'Binary files are not accepted.')
                }
                validateSourceContent(content)
                files.push({
                  path,
                  language: resolveLanguage(path),
                  content,
                  byteSize: size,
                  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
                })
                zip.readEntry()
              } catch (failure) { finish(failure) }
            })
          })
        } catch (failure) { finish(failure) }
      })
      zip.readEntry()
    }

    if (typeof input === 'string') {
      yauzl.open(input, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, onZipOpened)
    } else {
      yauzl.fromBuffer(input, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, onZipOpened)
    }
  })
}

module.exports = {
  extractSource,
  validatePath,
  LIMITS,
  sourceError,
  crc32,
  validateSourceContent,
  SUPPORTED_LANGUAGES,
  CODE_REVIEW_LANGUAGES,
  LANGUAGE_EXTENSIONS,
  resolveLanguage,
  shouldSkipEntry,
  assertSafePath,
  isSecretFile,
}
