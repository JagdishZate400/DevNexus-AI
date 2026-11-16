const {parseExpression}=require('@babel/parser')
const {sourceError}=require('./sourceArchive')
const {screenEvidenceText}=require('./documentEvidence')
const {extractEvidence}=require('./documentEvidence')
const {extractArchitectureEvidence,generateArchitectureDiagram}=require('./documentArchitectureAnalysis')
const v=require('./documentValidation')
const LIMITS=Object.freeze({facts:60,selectedFacts:12,promptBytes:60000,promptCharacters:30000,citations:60})
const contextError=()=>sourceError('documentation_context_limit','Documentation evidence exceeds bounded catalog limits. No partial document is generated.',413)
function factPriority(group) {
 switch(group) {
  case 'flow':           return 1200
  case 'architecture':   return 1100
  case 'communication':  return 1050
  case 'security':       return 1000
  case 'responsibility': return 950
  case 'storage':        return 900
  case 'overview':       return 850
  case 'technology':     return 800
  case 'instruction':    return 750
  case 'dependency':     return 700
  case 'engine':         return 650
  case 'route':          return 600
  case 'mount':          return 550
  case 'mounted':        return 550
  case 'environment':    return 500
  case 'symbol':         return 400
  case 'export':         return 300
  case 'artifact':       return 200
  case 'import':         return 150
  case 'locked':         return 100
  default:               return 50
 }
}
function buildCatalog(snapshot,spec) {
 // Recompute from authoritative content, not caller-provided analysis summaries.
 const analysis=extractEvidence(snapshot.files),files=new Map(snapshot.files.map(f=>[f.id,f])),rawFacts=[],available=new Set(),jsonTrees=new Map()
 const artifactRef=f=>({fileId:f.id,path:f.path,hash:f.sha256})
 function normalizeReference(reference) {
  const file=files.get(reference.fileId)
  if(!file || file.path!==reference.path || reference.hash!==file.sha256) throw sourceError('source_changed','Evidence identity changed.',409)
  const result=artifactRef(file)
  if(reference.lineStart!==undefined && file.content.length) {
   const lines=file.content.split(/\r\n|\n|\r/),start=reference.lineStart,end=Math.min(reference.lineEnd??start,start+4)
   if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||start>lines.length||end<start||end>lines.length) throw sourceError('invalid_evidence_reference','Evidence range is invalid.',400)
   Object.assign(result,{lineStart:start,lineEnd:end})
  }
  return result
 }
 function jsonRef(file,keys) {
  if(!jsonTrees.has(file.id)) {
   try{jsonTrees.set(file.id,parseExpression(file.content))}catch{throw sourceError('invalid_evidence_reference','Manifest locations could not be verified.',400)}
  }
  let node=jsonTrees.get(file.id)
  for(const key of keys) {
   const property=node?.properties?.filter(p=>(p.key?.value??p.key?.name)===key).at(-1)
   if(!property) throw sourceError('invalid_evidence_reference','Manifest property could not be located.',400)
   node=property.value
  }
  return {...artifactRef(file),lineStart:node.loc.start.line,lineEnd:node.loc.start.line}
 }
 function add(group,text,refs,classification) {
  available.add(group)
  const section=spec.sections[group]
  if(!section)return
  if(text.length>700)throw contextError()
  screenEvidenceText(text)
  const references=refs.map(normalizeReference)
  const suffix=classification==='declared-untested'?' This declaration has not been execution-tested.':classification==='inferred'?' This relationship is inferred from static mount analysis.':classification==='static-candidate'?' Static syntax does not prove runtime behavior.':' This fact describes the stored artifact, not a deployed system.'
  rawFacts.push({group,section,text,classification,references,explanations:[text,text+suffix],priority:factPriority(group)})
 }
 for(const entry of analysis.files) {
  const file=files.get(entry.reference.fileId),ref=artifactRef(file)
  available.add(entry.kind);available.add('paths')
  add('artifact',`${file.path} is present in the uploaded snapshot.`,[ref],'verified-artifact')
  if(entry.kind==='source') {
   for(const i of entry.imports)add('import',`${file.path} references module ${i.specifier}.`,[i.reference],'static-candidate')
   for(const e of entry.exports)add('export',`${file.path} declares export ${e.name}.`,[e.reference],'static-candidate')
   for(const s of entry.symbols)add('symbol',`${file.path} declares ${s.kind} ${s.name}${s.parameters?` with parameters (${s.parameters.join(', ')})`:''}.`,[s.reference],'static-candidate')
   for(const r of entry.routes)add('route',`${file.path}: ${r.method} ${r.path} is a static route declaration on ${r.receiver}.`,[r.reference],'static-candidate')
   for(const m of entry.mounts)add('mount',`${file.path}: ${m.receiver} declares mount prefix ${m.path}.`,[m.reference],'static-candidate')
   for(const e of entry.environment)add('environment',`${file.path} references environment name ${e.name}; no value is documented.`,[e.reference],'static-candidate')
  }
  if(entry.kind==='manifest') {
   const isJson=file.path.endsWith('.json')
   for(const d of entry.dependencies) {
    const ref=isJson?jsonRef(file,[d.group,d.name]):(d.reference||artifactRef(file))
    const rangeText=d.declaredRange?` with range ${d.declaredRange}`:''
    add('dependency',`${file.path} declares ${d.group} package ${d.name}${rangeText}.`,[ref],'verified-artifact')
   }
   for(const s of entry.scripts) {
    const ref=isJson?jsonRef(file,['scripts',s.name]):(s.reference||artifactRef(file))
    add('script',`${file.path} declares script ${s.name}${s.commandWithheld?'; its command is withheld':`: ${s.declaredCommand}`}.`,[ref],'declared-untested')
   }
   for(const e of entry.engines) {
    const ref=isJson?jsonRef(file,['engines',e.name]):(e.reference||artifactRef(file))
    add('engine',`${file.path} declares ${e.name} runtime range ${e.declaredRange}.`,[ref],'declared-untested')
   }
  }
  if(entry.kind==='lockfile') for(const p of entry.packages)add('locked',`${file.path} records ${p.path} at version ${p.version}.`,[jsonRef(file,['packages',p.path,'version'])],'verified-artifact')
  if(entry.kind==='setup') for(const i of entry.instructions) {
   const manifest=analysis.files.find(f=>f.reference.fileId===i.manifest.fileId),run=i.command.match(/^npm run (.+)$/)
   if(run && !manifest?.scripts.some(s=>s.name===run[1]&&!s.commandWithheld))continue
   add('instruction',`${file.path} declares setup command ${i.command}, cross-checked against ${i.manifest.path}.`,[i.reference,artifactRef(files.get(i.manifest.fileId))],'declared-untested')
  }
  if(entry.kind==='configuration-example') for(const key of entry.keys) {
   const line=file.content.split('\n').findIndex(line=>line===`${key}=`)+1
   add('environment',`${file.path} declares environment name ${key}; values and original comments were discarded.`,[{...ref,lineStart:line,lineEnd:line}],'verified-artifact')
  }
 }
 for(const r of analysis.mountedRoutes.routes) add('mounted',`${r.method} ${r.path} is an inferred mounted path from ${r.module}.`,[r.reference,...(r.mountReferences||[])],'inferred')
 if(spec.id==='architecture') {
  extractArchitectureEvidence(snapshot.files,analysis,add,(fileId,lineStart,lineEnd=lineStart)=>{
   const f=files.get(fileId)
   return {fileId,path:f.path,hash:f.sha256,lineStart,lineEnd}
  })
 }
 const missing=spec.required.filter(alternatives=>!alternatives.some(k=>available.has(k)))
 if(missing.length || !rawFacts.length) throw sourceError('documentation_evidence_insufficient','Required evidence for this documentation type is unavailable.',400)
 if (spec.id === 'project-structure' && rawFacts.length > LIMITS.facts) throw contextError()

 // Bounded deterministic selection: up to LIMITS.facts (60) facts, distributed across sections
 const bySection=new Map()
 for(const fact of rawFacts) {
  if(!bySection.has(fact.section)) bySection.set(fact.section,[])
  bySection.get(fact.section).push(fact)
 }
 for(const list of bySection.values()) {
  list.sort((a,b)=>{
   if(b.priority!==a.priority) return b.priority-a.priority
   const pathA=a.references[0]?.path||'',pathB=b.references[0]?.path||''
   if(pathA!==pathB) return pathA.localeCompare(pathB)
   return a.text.localeCompare(b.text)
  })
 }
 const selectedFacts=[],selectedCitations=new Set()
 function canAddFact(fact) {
  const newCitations=fact.references.filter(r=>r.lineStart!==undefined).map(r=>`${r.fileId}:${r.lineStart}:${r.lineEnd}`)
  const addedUnique=newCitations.filter(c=>!selectedCitations.has(c)).length
  return (selectedCitations.size+addedUnique)<=LIMITS.citations
 }
 for(const [,list] of bySection.entries()) {
  let taken=0
  for(const fact of list) {
   if(taken>=3 || selectedFacts.length>=LIMITS.facts) break
   if(canAddFact(fact)) {
    selectedFacts.push(fact)
    fact.references.filter(r=>r.lineStart!==undefined).forEach(r=>selectedCitations.add(`${r.fileId}:${r.lineStart}:${r.lineEnd}`))
    taken++
   }
  }
 }
 const remaining=rawFacts.filter(f=>!selectedFacts.includes(f))
 remaining.sort((a,b)=>{
  if(b.priority!==a.priority) return b.priority-a.priority
  const pathA=a.references[0]?.path||'',pathB=b.references[0]?.path||''
  if(pathA!==pathB) return pathA.localeCompare(pathB)
  return a.text.localeCompare(b.text)
 })
 for(const fact of remaining) {
  if(selectedFacts.length>=LIMITS.facts) break
  if(canAddFact(fact)) {
   selectedFacts.push(fact)
   fact.references.filter(r=>r.lineStart!==undefined).forEach(r=>selectedCitations.add(`${r.fileId}:${r.lineStart}:${r.lineEnd}`))
  }
 }
 const facts=selectedFacts.map((f,idx)=>({...f,id:`F${idx+1}`}))
 // Persist citation locations for deterministic inventories as well as AI-selected facts.
 const citations=[...new Map(facts.flatMap(f=>f.references).filter(r=>r.lineStart!==undefined).map(r=>[`${r.fileId}:${r.lineStart}:${r.lineEnd}`,{fileId:r.fileId,path:r.path,lineStart:r.lineStart,lineEnd:r.lineEnd}])).values()]
 if(citations.length>LIMITS.citations)throw contextError()
 const unresolved=analysis.files.reduce((n,f)=>n+(f.unresolved?.length||0),0)+analysis.mountedRoutes.unresolved.length
 const unknowns=[
  'Runtime behavior, installation success, deployment topology, credentials and design rationale are not established by this snapshot.',
  'Static route inventories do not establish request schemas, responses, middleware authorization or endpoint reachability.',
  ...(!available.has('manifest')?['Package manifests were unavailable; dependency versions and prerequisites cannot be established.']:[]),
  ...(!available.has('instruction')?['No supported source-evidenced installation instructions were found.']:[]),
  `Static analysis reported ${unresolved} unresolved constructs; inventories may be incomplete.`,
 ]
 const includedFileIds=[...new Set(facts.flatMap(f=>f.references.map(r=>r.fileId)))]
 return {facts,citations,analysis,unknowns,available:[...available],files:snapshot.files,includedFileIds}
}
function promptCatalog(catalog) {
 const context=JSON.stringify({facts:catalog.facts.map(({id,section,classification,explanations})=>({factId:id,section,classification,explanations}))})
 if(Buffer.byteLength(context)>LIMITS.promptBytes||context.length>LIMITS.promptCharacters)throw contextError()
 return context
}
function validateOrganization(text,catalog,spec) {
 const bad=()=>{throw sourceError('ai_malformed_response','Gemini returned unsupported documentation facts or structure.',502)}
 const exact=(object,keys)=>object && typeof object==='object' && !Array.isArray(object) && Object.keys(object).length===keys.length && keys.every(k=>Object.hasOwn(object,k))
 let value;try{value=JSON.parse(text)}catch{bad()}
 if(!exact(value,['sections'])||!Array.isArray(value.sections)||!value.sections.length||value.sections.length>Object.keys(spec.sections).length)bad()
 const seen=new Set(),sections=new Set();let count=0
 for(const section of value.sections) {
  if(!exact(section,['title','claims'])||!Object.values(spec.sections).includes(section.title)||sections.has(section.title)||!Array.isArray(section.claims)||!section.claims.length)bad()
  sections.add(section.title)
  for(const claim of section.claims) {
   if(!exact(claim,['factId','explanation'])||typeof claim.factId!=='string'||seen.has(claim.factId))bad()
   const fact=catalog.facts.find(f=>f.id===claim.factId)
   if(!fact||fact.section!==section.title||!fact.explanations.includes(claim.explanation))bad()
   seen.add(claim.factId);if(++count>LIMITS.selectedFacts)bad()
  }
 }
 return value.sections
}
function escape(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\`*_{}\[\]()#+.!|>~-])/g,'\\$1')}
function cite(fact){return fact.references.map(r=>`[Source: ${escape(r.path)}${r.lineStart?`, lines ${r.lineStart}-${r.lineEnd}`:', artifact identity'}]`).join(' ')}
function renderDocument(spec,catalog,sections) {
 const output=[`# ${spec.title}`,'','AI-organized source evidence. Technical statements and inventories are rendered from server-validated facts; AI does not author arbitrary technical prose.','','## Evidence scope',`${catalog.files.length} stored files were verified against their SHA-256 snapshots. All files were analyzed; facts referencing ${catalog.includedFileIds.length} files were supplied to Gemini. ${catalog.files.length-catalog.includedFileIds.length} files had no type-relevant facts and were excluded from the provider context. No raw setup prose or configuration values were sent.`]
 if(spec.id==='architecture') {
  const {mermaid,text}=generateArchitectureDiagram(catalog.files)
  output.push('','## Architecture Diagram')
  output.push('> **Renderer Notice:** The DevNexus AI in-browser document preview and PDF export render code blocks as preformatted monospace text and do not execute client-side Mermaid graphical rendering. A standard Mermaid syntax block is provided below for Mermaid-compatible viewers and Markdown renderers, accompanied by a readable text-based architecture diagram.')
  output.push('','### Mermaid Architecture Diagram','```mermaid',mermaid,'```')
  output.push('','### Text-Based Architecture Diagram','```text',text,'```')
 }
 output.push('','## AI-organized observations')
 for(const section of sections) {
  output.push('',`### ${section.title}`)
  for(const claim of section.claims) {const fact=catalog.facts.find(f=>f.id===claim.factId);output.push(`- **${fact.classification}**: ${escape(claim.explanation)} ${cite(fact)}`)}
 }
 if(['readme','project-structure'].includes(spec.id)) {
  output.push('','## Uploaded folder tree','```text')
  const paths=[...catalog.analysis.structure.folders.map(p=>p+'/'),...catalog.analysis.structure.files].sort()
  // Quoted labels cannot become Markdown fences, even for backticks in paths.
  for(const path of paths){const parts=path.split('/').filter(Boolean);output.push('  '.repeat(parts.length-1)+JSON.stringify(parts.at(-1))+(path.endsWith('/')?'/':''))}
  output.push('```','This tree covers uploaded artifacts only, not unseen repository contents.')
 }
 output.push('','## Deterministic evidence inventory')
 for(const section of [...new Set(Object.values(spec.sections))]) {
  const facts=catalog.facts.filter(f=>f.section===section)
  output.push('',`### ${section}`)
  if(!facts.length)output.push('Evidence unavailable for this section.')
  for(const fact of facts)output.push(`- **${fact.classification}**: ${escape(fact.text)} ${cite(fact)}`)
 }
 output.push('','## Unknowns and limitations',...catalog.unknowns.map(t=>`- ${t}`),'','## Snapshot references')
 for(const f of catalog.files)output.push(`- ${escape(f.path)} — SHA-256: ${f.sha256}`)
 const markdown=output.join('\n')+'\n';v.markdown(markdown);return markdown
}
module.exports={buildCatalog,promptCatalog,validateOrganization,renderDocument,LIMITS}
