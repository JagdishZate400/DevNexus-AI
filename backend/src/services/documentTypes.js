// Capability is a server contract, not permission to enable a UI option.
const definitions = [
  ['readme', 'README', [['source']]],
  ['project-overview', 'Project Overview', [['source']]],
  ['installation-guide', 'Installation Guide', [['manifest']]],
  ['architecture', 'Architecture Documentation', [['source'], ['import','route','mount']]],
  ['project-structure', 'Project Structure', [['paths']]],
  ['module-documentation', 'Module Documentation', [['source'], ['symbol','export']]],
  ['api-documentation', 'API Documentation', [['route']]],
  ['developer-notes', 'Developer Notes', [['source'], ['symbol','script','import']]],
  ['technology-stack', 'Technology Stack', [['manifest']]],
]
const DOCUMENT_TYPES = Object.freeze(definitions.map(([id, displayName, evidenceRequirements]) => Object.freeze({
  id, displayName, evidenceRequirements: Object.freeze(evidenceRequirements.map(alternatives=>Object.freeze(alternatives))),
  capability: 'generation-supported',
  frontendEnabled: id === 'project-overview',
})))
const LEGACY_TYPES = Object.freeze({ 'technical-architecture': 'architecture', 'code-documentation': 'module-documentation' })
const CANONICAL_IDS = Object.freeze(DOCUMENT_TYPES.map(type => type.id))
const STORAGE_IDS = Object.freeze([...CANONICAL_IDS, ...Object.keys(LEGACY_TYPES)])
// Return a separate interpretation; callers must retain the original stored value.
function canonicalType(id) {
  if (typeof id !== 'string') return null
  return CANONICAL_IDS.includes(id) ? id : Object.hasOwn(LEGACY_TYPES, id) ? LEGACY_TYPES[id] : null
}
function generationSupported(id) {
  return DOCUMENT_TYPES.some(type => type.id === id && type.capability === 'generation-supported')
}
module.exports = { DOCUMENT_TYPES, LEGACY_TYPES, CANONICAL_IDS, STORAGE_IDS, canonicalType, generationSupported }
