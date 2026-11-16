// Pure, offline evidence extraction. Never reads disk, executes code or loads a project.
// Metadata ingestion uses a separate owner-scoped store; raw metadata is never an AI prompt.
const crypto = require('crypto')
const { validatePath, validateSourceContent, resolveLanguage } = require('./sourceArchive')
const LIMITS = Object.freeze({ files: 200, fileBytes: 65536, totalBytes: 262144, tokens: 30000 })
const fail = code => { throw Object.assign(new Error('Documentation evidence rejected.'), { code }) }
const DOCS = /^(?:README|INSTALL|CONTRIBUTING)\.md$/i
function screenEvidenceText(content) {
  if(typeof content!=='string' || /[\uD800-\uDFFF\uFFFD\uFEFF]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(content)) fail('invalid_text')
  try { validateSourceContent(content) } catch { fail('sensitive_or_invalid_content') }
  if (/(?:authorization|token|credential|password|secret|api[_-]?key)\s*["']?\s*[:=]\s*["'][^"'\r\n]+["']/i.test(content) || /\b(?:Bearer\s+[A-Za-z0-9._-]{8,}|[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@)/i.test(content)) fail('sensitive_or_invalid_content')
}
function evidencePath(path) {
  if (typeof path !== 'string') fail('invalid_path')
  // Reuse upload path rules with a harmless extension, without relaxing upload policy.
  const leaf = path.split('/').at(-1)
  const isManifest = ['package.json', 'requirements.txt', 'pyproject.toml'].includes(leaf)
  const isLockfile = ['package-lock.json', 'npm-shrinkwrap.json'].includes(leaf)
  const isSetup = DOCS.test(leaf)
  const isConfigExample = leaf === '.env.example'
  const source = Boolean(resolveLanguage(leaf)) && !isManifest && !isLockfile && !isSetup && !isConfigExample
  const kind = source ? 'source' : isManifest ? 'manifest' : isLockfile ? 'lockfile' : isSetup ? 'setup' : isConfigExample ? 'configuration-example' : null
  if (!kind || /(?:^|\/)(?:credentials|secrets)(?:\.|\/|$)/i.test(path)) fail('unsupported_file')
  const safe = kind === 'source' ? path : path.slice(0, -leaf.length) + (kind === 'configuration-example' ? 'configuration-example.js' : leaf + '.js')
  try { validatePath(safe) } catch { fail('invalid_path') }
  return kind
}
function reference(file, lineStart = 1, lineEnd = lineStart) {
  return { fileId: file.id, path: file.path, hash: file.sha256, lineStart, lineEnd }
}
const { analyzeSource, resolveMountedRoutes } = require('./documentSourceAnalysis')
function sourceFacts(file) { return analyzeSource(file) }
function pythonRequirementsFacts(file) {
  const dependencies = []
  const lines = file.content ? file.content.split(/\r\n|\n|\r/) : []
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx]
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('-')) continue
    const clean = line.split('#')[0].split(';')[0].trim()
    const match = clean.match(/^([a-zA-Z0-9_.-]{1,80})(?:\[[a-zA-Z0-9_, -]+\])?\s*([~=><!^].*)?$/)
    if (!match) continue
    const name = match[1]
    const declaredRange = match[2] ? match[2].trim() : '*'
    if (!/^[\d*^~<>=|. x+-,!]+$/.test(declaredRange)) continue
    dependencies.push({
      group: 'dependencies',
      name,
      declaredRange,
      reference: reference(file, idx + 1, idx + 1),
    })
  }
  return { dependencies, scripts: [], engines: [], reference: reference(file), withheldScripts: 0 }
}
function pyprojectTomlFacts(file) {
  const dependencies = []
  const lines = file.content ? file.content.split(/\r\n|\n|\r/) : []
  let inDependencies = false
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx]
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inDependencies = /\[(?:project\.dependencies|tool\.poetry\.dependencies)\]/i.test(line)
      continue
    }
    if (line.startsWith('dependencies = [') || line.startsWith('dependencies=[')) {
      inDependencies = true
      continue
    }
    if (inDependencies && line === ']') {
      inDependencies = false
      continue
    }
    if (inDependencies) {
      const arrayItem = line.match(/^["']([a-zA-Z0-9_.-]{1,80})(?:\[[a-zA-Z0-9_, -]+\])?\s*([~=><!^].*?)?["'],?$/)
      if (arrayItem) {
        dependencies.push({
          group: 'dependencies',
          name: arrayItem[1],
          declaredRange: arrayItem[2] ? arrayItem[2].trim() : '*',
          reference: reference(file, idx + 1, idx + 1),
        })
        continue
      }
      const tableItem = line.match(/^([a-zA-Z0-9_.-]{1,80})\s*=\s*["']([^"']+)["']/)
      if (tableItem) {
        dependencies.push({
          group: 'dependencies',
          name: tableItem[1],
          declaredRange: tableItem[2].trim(),
          reference: reference(file, idx + 1, idx + 1),
        })
        continue
      }
    }
  }
  return { dependencies, scripts: [], engines: [], reference: reference(file), withheldScripts: 0 }
}
function manifestFacts(file) {
  const leaf = file.path.split('/').at(-1)
  if (leaf === 'requirements.txt') return pythonRequirementsFacts(file)
  if (leaf === 'pyproject.toml') return pyprojectTomlFacts(file)
  let data
  try { data = JSON.parse(file.content) } catch { fail('malformed_manifest') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('malformed_manifest')
  const result = { dependencies: [], scripts: [], engines: [], reference: reference(file), withheldScripts: 0 }
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (data[group] === undefined) continue
    if (!data[group] || typeof data[group] !== 'object' || Array.isArray(data[group])) fail('malformed_manifest')
    for (const [name, version] of Object.entries(data[group])) {
      if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || typeof version !== 'string' || version.length > 100) fail('malformed_manifest')
      // No private registry URLs, local paths, credentials or executable metadata.
      if (/^[\d*^~<>=|. x+-]+$/i.test(version)) result.dependencies.push({ group, name, declaredRange: version })
    }
  }
  if (data.scripts !== undefined && (!data.scripts || typeof data.scripts !== 'object' || Array.isArray(data.scripts))) fail('malformed_manifest')
  for (const [name, command] of Object.entries(data.scripts || {})) {
    if (!/^[a-z0-9:_-]{1,80}$/i.test(name) || typeof command !== 'string') fail('malformed_manifest')
    // Retain script names only. Script bodies are untrusted executable strings.
    const safe = /^(?:node [a-zA-Z0-9_./-]+\.(?:js|mjs|cjs)|vite(?: build| preview)?|tsc(?: --noEmit)?|node --test(?: [a-zA-Z0-9_./*-]+)?)$/.test(command) && !command.includes('..')
    result.scripts.push({ name, commandWithheld: !safe, ...(safe ? {declaredCommand:command} : {}) }); if(!safe) result.withheldScripts++
  }
  if (data.engines !== undefined && (!data.engines || typeof data.engines !== 'object' || Array.isArray(data.engines))) fail('malformed_manifest')
  for (const [name, range] of Object.entries(data.engines || {})) if (['node', 'npm'].includes(name) && typeof range === 'string' && /^[\d*^~<>=|. x+-]{1,100}$/i.test(range)) result.engines.push({ name, declaredRange: range })
  return result
}
function lockFacts(file) {
  let data
  try { data=JSON.parse(file.content) } catch { fail('malformed_manifest') }
  if(!data || ![2,3].includes(data.lockfileVersion) || !data.packages || typeof data.packages!=='object' || Array.isArray(data.packages)) fail('unsupported_lockfile')
  const packages=[]
  for(const [path,entry] of Object.entries(data.packages)) {
    if(!path) continue
    if(!/^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._/-]+$/i.test(path) || path.includes('..') || !entry || typeof entry!=='object') fail('malformed_manifest')
    if(typeof entry.version==='string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/i.test(entry.version)) packages.push({path,version:entry.version})
  }
  return {lockfileVersion:data.lockfileVersion,packages,reference:reference(file),urlsWithheld:true}
}
function sanitizeExample(content) {
  if(typeof content!=='string' || Buffer.byteLength(content)>LIMITS.fileBytes || /[\uD800-\uDFFF\uFFFD\uFEFF]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(content)) fail('invalid_text')
  const keys=[]
  for(const line of content.split(/\r\n?|\n/)) {
    if(!line.trim() || line.trim().startsWith('#')) continue
    const match=line.match(/^([A-Z][A-Z0-9_]{0,79})=[^\r\n]*$/)
    if(!match || keys.includes(match[1])) fail('configuration_value_rejected')
    keys.push(match[1])
  }
  return keys.map(key=>`${key}=`).join('\n')+'\n'
}
function enrichSetup(output, files) {
  const byPath=new Map(files.map(f=>[f.path,f]))
  for(const facts of output.filter(f=>f.kind==='setup')) {
    const file=byPath.get(facts.reference.path),dir=file.path.slice(0,file.path.lastIndexOf('/')+1)
    const manifest=output.find(f=>f.kind==='manifest'&&f.reference.path===dir+'package.json')
    const lock=output.find(f=>f.kind==='lockfile'&&[dir+'package-lock.json',dir+'npm-shrinkwrap.json'].includes(f.reference.path))
    facts.instructions=[]
    let fence=false,language=''
    file.content.split(/\r\n?|\n/).forEach((line,i)=>{
      if(/^```/.test(line)) { fence=!fence; language=line.slice(3).trim(); return }
      if(!fence || !['sh','bash','shell','powershell',''].includes(language)) return
      const command=line.trim().replace(/^\$ /,'')
      const run=command.match(/^npm run ([a-z0-9:_-]{1,80})$/i)
      if(manifest && ((command==='npm ci'&&lock) || command==='npm install' || (run&&manifest.scripts.some(s=>s.name===run[1])))) facts.instructions.push({command,reference:reference(file,i+1),manifest:manifest.reference,verification:'source-evidenced-not-executed'})
    })
    facts.limitations=['Only exact npm commands cross-checked against same-directory manifests are retained. Working directory and successful execution are not verified.']
  }
}
function extractEvidence(files) {
  if (!Array.isArray(files) || files.length > LIMITS.files) fail('file_limit')
  let bytes = 0; const paths = new Set(), ids = new Set(), output = []
  for (const file of files) {
    if (!file || typeof file.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(file.id) || typeof file.content !== 'string' || typeof file.sha256 !== 'string') fail('invalid_file')
    const kind = evidencePath(file.path), size = Buffer.byteLength(file.content)
    bytes += size
    if (size > LIMITS.fileBytes || bytes > LIMITS.totalBytes) fail('context_limit')
    if (paths.has(file.path.toLowerCase()) || ids.has(file.id)) fail('duplicate_file')
    paths.add(file.path.toLowerCase()); ids.add(file.id)
    if (crypto.createHash('sha256').update(file.content).digest('hex') !== file.sha256) fail('source_integrity')
    if (/[\uD800-\uDFFF]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(file.content)) fail('invalid_text')
    if (kind === 'configuration-example') {
      // Never expose values, even placeholders. Only empty KEY= declarations accepted.
      const keys = []
      for (const line of file.content.split(/\r\n?|\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        const match = line.match(/^([A-Z][A-Z0-9_]{0,79})=\s*$/)
        if (!match) fail('configuration_value_rejected')
        keys.push(match[1])
      }
      output.push({ kind, reference: reference(file), keys, transformation:'environment-names-only; hash and line positions refer to sanitized declarations' }); continue
    }
    screenEvidenceText(file.content)
    output.push({ kind, reference: reference(file), ...(kind === 'source' ? sourceFacts(file) : kind === 'manifest' ? manifestFacts(file) : kind === 'lockfile' ? lockFacts(file) : {
      // Setup prose/commands await a separate reviewed validator; no text enters prompts.
      headings: file.content.split(/\r\n?|\n/).flatMap((line, i) => /^#{1,6} /.test(line) ? [{ line: i + 1, level: line.match(/^#+/)[0].length }] : []),
      contentWithheld: true,
    }) })
  }
  enrichSetup(output, files)
  const mounted = resolveMountedRoutes(output.filter(f=>f.kind==='source').map(f=>({...f,path:f.reference.path})))
  const folders = new Set()
  for (const path of paths) { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) if (paths.has(parts.slice(0, i).join('/'))) fail('path_conflict') }
  for (const file of files) { const parts = file.path.split('/'); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/')) }
  return { mountedRoutes: mounted, files: output, structure: { files: files.map(file => file.path).sort(), folders: [...folders].sort(), scope: 'uploaded-snapshot' }, bytes, promptReady: false }
}
module.exports = { extractEvidence, evidencePath, LIMITS, sanitizeExample, screenEvidenceText }
