const crypto = require('crypto')
const {
  validatePath,
  validateSourceContent,
  sourceError,
  SUPPORTED_LANGUAGES,
  resolveLanguage,
} = require('./sourceArchive')
const { REVIEW_SOURCE_LIMITS } = require('./reviewSource')

const CONTEXT_LIMITS = Object.freeze({ files: 10, bytes: 60000, characters: 30000 })

/**
 * Deterministically scores a file for Project Overview inclusion.
 * Higher score = higher priority for overview representation.
 *
 * Tier 1 (1000): Application & framework entry points (backend & frontend)
 * Tier 2 (800):  Core architecture, engines, services, APIs, routing (code only)
 * Tier 3 (600):  Key package manifests and primary configuration files
 * Tier 4 (400):  Frontend components, pages, views
 * Tier 5 (250):  General source code in any supported programming language
 * Tier 6 (100):  Non-code companion assets (HTML, CSS, JSON data, YAML)
 * Tier 7 (50):   Tests, test mocks, sample data fixtures (deprioritized)
 */
function scoreFileForOverview(file) {
  const p = String(file.path || '').normalize('NFC').toLowerCase()
  const leaf = p.split('/').at(-1)
  const isTest = /(?:^|\/)(?:tests?|__tests__|spec|fixtures?|mocks?|sample_data)(?:\/|$)|(?:_|\.)(?:test|spec)\.[a-z0-9]+$/i.test(p)
  const isCode = ['Python', 'JavaScript', 'TypeScript', 'Java', 'Go', 'Rust', 'C', 'C++', 'C#', 'PHP', 'SQL'].includes(file.language)

  let score = 200

  // Tier 1: Application Entry Points
  const isBackendEntry = /^(?:.*\/)?(?:main\.(?:py|go|rs)|app\.(?:py)|server\.(?:py)|wsgi\.py|asgi\.py|main\.java|.*application\.java)$/i.test(p)
  const isFrontendEntry = /^(?:.*\/)?(?:main\.(?:jsx?|tsx?)|app\.(?:jsx?|tsx?)|index\.(?:jsx?|tsx?)|server\.(?:jsx?|tsx?)|app\.js)$/i.test(p)
  if (isBackendEntry || isFrontendEntry) {
    score = 1000
  }
  // Tier 2: Core Architecture & Engines (code only)
  else if (isCode && (/(?:^|\/)(?:core|services|controllers|routes|api|models|db|middleware|rules|engines|decision|gateway)(?:\/|$)/i.test(p) ||
           /(?:gateway|engine|decision|rule|auth|router|service|handler|controller|classifier|detector|proxy|pipeline)/i.test(leaf))) {
    score = 800
  }
  // Tier 3: Key Manifests & Configuration
  else if (['package.json', 'requirements.txt', 'pyproject.toml', 'setup.py', 'cargo.toml', 'go.mod', 'pom.xml'].includes(leaf) ||
           /^(?:config\.py|settings\.py|vite\.config\.[jt]s|tsconfig\.json)$/i.test(leaf)) {
    score = 600
  }
  // Tier 4: Frontend Components & Pages (code only)
  else if (isCode && (/(?:^|\/)(?:components|pages|views|templates)(?:\/|$)/i.test(p) || /\.(?:jsx|tsx|vue|svelte)$/i.test(leaf))) {
    score = 400
  }
  // Tier 5: General Code
  else if (isCode) {
    score = 250
  }
  // Tier 6: Companion Assets
  else {
    score = 100
  }

  // Deprioritize tests below production code
  if (isTest) {
    score = Math.min(score, 50)
  }

  return score
}

/**
 * Validates a single source file for Project Overview generation across all 15 supported languages.
 * Preserves whole-file integrity and security checks. Never truncates source.
 */
function validateOverviewSource(file) {
  validatePath(file.path)
  const resolved = resolveLanguage(file.path)
  if (!SUPPORTED_LANGUAGES.includes(file.language) || !SUPPORTED_LANGUAGES.includes(resolved)) {
    throw sourceError('unsupported_file', 'Unsupported source language.')
  }
  validateSourceContent(file.content)
  if (file.content.length > REVIEW_SOURCE_LIMITS.characters || Buffer.byteLength(file.content) > REVIEW_SOURCE_LIMITS.bytes) {
    throw sourceError('source_limit', 'Single-file overview supports at most 50,000 characters. Source will not be truncated.', 413)
  }
  const hash = crypto.createHash('sha256').update(file.content).digest('hex')
  if (hash !== file.sha256) {
    throw sourceError('source_integrity', 'Stored source hash does not match its contents.', 409)
  }
  return {
    path: file.path,
    sourceHash: hash,
    bytes: Buffer.byteLength(file.content),
    lines: file.content ? file.content.split(/\r\n|\n|\r/).length : 0,
    truncated: false,
  }
}

/**
 * Deterministically selects representative whole source files within the 10 files,
 * 60,000 source bytes, and 30,000 characters overview budget.
 *
 * Does not reject projects simply because some files are excluded.
 * Unsafe files are excluded with explicit reasons.
 */
function selectOverviewFiles(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.files) || !snapshot.totalFiles || !snapshot.files.length) {
    throw sourceError('empty_source_project', 'Project has no uploaded source files.', 400)
  }

  const ids = new Set(), paths = new Set()
  const candidates = []
  const excludedFiles = []

  for (const file of snapshot.files) {
    if (typeof file.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(file.id)) {
      throw sourceError('source_metadata_conflict', 'Invalid source file identity.', 409)
    }
    const id = file.id.toLowerCase()
    const p = String(file.path || '').normalize('NFC').toLowerCase()
    if (ids.has(id) || paths.has(p)) {
      throw sourceError('source_metadata_conflict', 'Source discovery contains duplicate file identities or paths.', 409)
    }
    ids.add(id); paths.add(p)

    // Path safety validation
    try {
      validatePath(file.path)
    } catch (err) {
      excludedFiles.push({ fileId: file.id, path: file.path, reason: 'unsafe_path', message: err.message })
      continue
    }

    // Supported language check
    const resolved = resolveLanguage(file.path)
    if (!SUPPORTED_LANGUAGES.includes(file.language) || !SUPPORTED_LANGUAGES.includes(resolved)) {
      excludedFiles.push({ fileId: file.id, path: file.path, reason: 'unsupported_language', message: 'Language not in supported categories.' })
      continue
    }

    // Individual file limits check
    const byteSize = Number(file.byteSize)
    const charCount = Number(file.characterCount)
    const lineCount = Number(file.lineCount)

    if (!Number.isSafeInteger(byteSize) || byteSize < 0 ||
        !Number.isSafeInteger(charCount) || charCount < 0 ||
        !Number.isSafeInteger(lineCount) || lineCount < 0 ||
        !/^[a-f0-9]{64}$/i.test(file.sha256 || '')) {
      excludedFiles.push({ fileId: file.id, path: file.path, reason: 'invalid_source_metadata', message: 'Source metadata is incomplete or invalid.' })
      continue
    }

    if (byteSize > REVIEW_SOURCE_LIMITS.bytes || charCount > REVIEW_SOURCE_LIMITS.characters || lineCount > REVIEW_SOURCE_LIMITS.lines) {
      excludedFiles.push({ fileId: file.id, path: file.path, reason: 'source_limit', message: 'File exceeds single-file limits.' })
      continue
    }

    const score = scoreFileForOverview(file)
    candidates.push({
      id: file.id,
      path: file.path,
      language: file.language,
      byteSize,
      characterCount: charCount,
      lineCount,
      sha256: file.sha256,
      score,
    })
  }

  // Deterministic sort: score DESC, depth ASC, path normalized ASC, id ASC
  candidates.sort((a, b) => {
    const scoreDiff = b.score - a.score
    if (scoreDiff !== 0) return scoreDiff

    const depthDiff = a.path.split('/').length - b.path.split('/').length
    if (depthDiff !== 0) return depthDiff

    const pathOrder = Buffer.compare(
      Buffer.from(String(a.path || '').normalize('NFC')),
      Buffer.from(String(b.path || '').normalize('NFC'))
    )
    if (pathOrder !== 0) return pathOrder

    return Buffer.compare(Buffer.from(a.id.toLowerCase()), Buffer.from(b.id.toLowerCase()))
  })

  const selectedFiles = []
  let totalBytes = 0
  let totalCharacters = 0

  for (const candidate of candidates) {
    const fileBytes = candidate.byteSize
    const fileChars = candidate.characterCount

    // If this file on its own exceeds the entire overview budget, exclude it
    if (fileBytes > CONTEXT_LIMITS.bytes || fileChars > CONTEXT_LIMITS.characters) {
      excludedFiles.push({
        fileId: candidate.id,
        path: candidate.path,
        language: candidate.language,
        bytes: fileBytes,
        characters: fileChars,
        reason: 'single_file_exceeds_budget',
        message: `File (${fileBytes} bytes, ${fileChars} chars) exceeds the overview context limit of 60,000 bytes and 30,000 characters.`,
      })
      continue
    }

    // If max files already reached, exclude remaining candidates
    if (selectedFiles.length >= CONTEXT_LIMITS.files) {
      excludedFiles.push({
        fileId: candidate.id,
        path: candidate.path,
        language: candidate.language,
        bytes: fileBytes,
        characters: fileChars,
        reason: 'file_count_budget_reached',
        message: 'Overview context limit of 10 whole files reached.',
      })
      continue
    }

    // If adding this file would breach remaining byte/character budget, exclude it and continue
    if (totalBytes + fileBytes > CONTEXT_LIMITS.bytes || totalCharacters + fileChars > CONTEXT_LIMITS.characters) {
      excludedFiles.push({
        fileId: candidate.id,
        path: candidate.path,
        language: candidate.language,
        bytes: fileBytes,
        characters: fileChars,
        reason: 'context_size_budget_exceeded',
        message: 'Adding file would exceed overview context budget (60,000 bytes or 30,000 characters).',
      })
      continue
    }

    // Successfully selected whole file
    selectedFiles.push({
      fileId: candidate.id,
      path: candidate.path,
      language: candidate.language,
      bytes: fileBytes,
      characters: fileChars,
      lines: candidate.lineCount,
      sha256: candidate.sha256,
      score: candidate.score,
    })
    totalBytes += fileBytes
    totalCharacters += fileChars
  }

  // If no files could be selected, reject with context limit
  if (!selectedFiles.length) {
    throw sourceError(
      'documentation_context_limit',
      'Overview supports at most 10 whole files, 60,000 UTF-8 bytes and 30,000 characters. No source is truncated.',
      413
    )
  }

  return {
    totalDiscoveredFiles: snapshot.totalFiles,
    selectedFiles,
    excludedFiles,
    totalSelectedBytes: totalBytes,
    totalSelectedCharacters: totalCharacters,
  }
}

module.exports = {
  CONTEXT_LIMITS,
  scoreFileForOverview,
  validateOverviewSource,
  selectOverviewFiles,
}
