// Mirrors the canonical backend contract. This registry is not a readiness signal.
export const DOCUMENTATION_TYPES = Object.freeze([
  ['readme','README','Project introduction, declared dependencies and source-evidenced setup.','Source, package manifest and setup documentation','BookOpen'],
  ['project-overview','Project Overview','Source-grounded summary of observed components and functionality.','Uploaded multi-language source (Python, JavaScript, TypeScript, etc.)','FileText'],
  ['installation-guide','Installation Guide','Declared prerequisites, setup commands and configuration names.','Package manifest (package.json, requirements.txt, pyproject.toml) and optional setup instructions','Wrench'],
  ['architecture','Architecture Documentation','Static components, module relationships and inferred routing.','Source with imports, routes or mounts','GitBranch'],
  ['project-structure','Project Structure','A deterministic tree of the uploaded files and directories.','At least one uploaded artifact','FolderOpen'],
  ['module-documentation','Module Documentation','Declared functions, classes, parameters, imports and exports.','Source with symbols or exports','Package'],
  ['api-documentation','API Documentation','Static route declarations and separately labeled inferred endpoints.','Static Express route declarations','Code'],
  ['developer-notes','Developer Notes','Code navigation, declared scripts and configuration references.','Source with symbols, scripts or imports','Lightbulb'],
  ['technology-stack','Technology Stack','Declared dependency ranges, lockfile versions and runtime requirements.','Package manifest with relevant facts','Layers'],
].map(([id,label,description,evidence,icon])=>Object.freeze({id,label,description,evidence,icon})))
export const LEGACY_DOCUMENT_TYPES=Object.freeze({'technical-architecture':'architecture','code-documentation':'module-documentation'})
// No deployment/readiness endpoint exists. Never derive this from backend registry,
// health, environment flags, URL parameters, localStorage, or a generation response.
export const ACCEPTED_DOCUMENT_TYPES=Object.freeze(['project-overview','readme','installation-guide','architecture','project-structure','module-documentation','api-documentation','developer-notes','technology-stack'])
export function canonicalDocumentType(id){
  return DOCUMENTATION_TYPES.some(type=>type.id===id)?id:Object.hasOwn(LEGACY_DOCUMENT_TYPES,id)?LEGACY_DOCUMENT_TYPES[id]:null
}
export function documentTypeLabel(id){return DOCUMENTATION_TYPES.find(type=>type.id===canonicalDocumentType(id))?.label || 'Unknown document type'}
export function isLegacyDocumentType(id){return Object.hasOwn(LEGACY_DOCUMENT_TYPES,id)}
export function canGenerateDocumentType(id,acceptedTypes=ACCEPTED_DOCUMENT_TYPES){return DOCUMENTATION_TYPES.some(type=>type.id===id)&&Array.isArray(acceptedTypes)&&acceptedTypes.includes(id)}
