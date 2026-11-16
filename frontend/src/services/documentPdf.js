import {documentTypeLabel,isLegacyDocumentType} from '../data/documentationTypes'
let library
function plain(value) {
  return String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[entity]))
    .replace(/\\([\\`*_{}[\]()#+.!|>~-])/g,'$1').replace(/[\u2010-\u2015\u2212]/g,'-')
}
function wrapTokens(text) {return text.replace(/\S{45,}/gu,word=>Array.from(word).map((char,index)=>index && index%32===0 ? `\u200b${char}` : char).join(''))}
function inline(text) {
  return text.split(/(!?\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).filter(Boolean).map(part=>{
    if(part.startsWith('!['))return {text:'[Image omitted]',italics:true,color:'#64748b'}
    const link=part.match(/^\[([^\]]*)\]\(([^)]*)\)$/)
    // Links remain inert text in the exported PDF. Never emit PDF actions/URLs.
    if(link)return {text:wrapTokens(plain(`${link[1]} (${link[2]})`))}
    if(part.startsWith('**') && part.endsWith('**'))return {text:wrapTokens(plain(part.slice(2,-2))),bold:true}
    if(part.startsWith('*') && part.endsWith('*'))return {text:wrapTokens(plain(part.slice(1,-1))),italics:true}
    if(part.startsWith('`') && part.endsWith('`'))return {text:wrapTokens(plain(part.slice(1,-1))),background:'#eef2f6'}
    return {text:wrapTokens(plain(part))}
  })
}
export function markdownPdfBlocks(markdown) {
  const blocks=[],lines=markdown.replace(/\r\n?|\u2028|\u2029/g,'\n').split('\n')
  let paragraph=[],list=null,code=null
  function flush(){if(paragraph.length){blocks.push({text:inline(paragraph.join(' ')),margin:[0,0,0,9]});paragraph=[]}if(list){blocks.push({...list,margin:[0,1,0,10]});list=null}}
  for(const line of lines){
    if(/^\s*```/.test(line)){flush();if(code!==null){blocks.push({text:wrapTokens(plain(code.join('\n'))),fontSize:9,background:'#f1f5f9',margin:[8,6,8,12],preserveLeadingSpaces:true});code=null}else code=[];continue}
    if(code!==null){code.push(line);continue}
    const heading=line.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    if(heading){flush();blocks.push({text:inline(heading[2]),style:`h${Math.min(heading[1].length,3)}`,headlineLevel:heading[1].length});continue}
    const bullet=line.match(/^\s*[-*+]\s+(.+)$/),ordered=line.match(/^\s*(\d+)\.\s+(.+)$/)
    if(bullet || ordered){
      if(paragraph.length || (list && (ordered ? !list.ol : !list.ul)))flush()
      const key=ordered ? 'ol' : 'ul'
      list ||= {[key]:[],...(ordered ? {start:Number(ordered[1])} : {})}
      list[key].push({text:inline(bullet ? bullet[1] : ordered[2]),margin:[0,0,0,4]});continue
    }
    if(!line.trim()){flush();continue}
    if(list)flush()
    if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){flush();blocks.push({canvas:[{type:'line',x1:0,y1:0,x2:475,y2:0,lineWidth:0.5,lineColor:'#cbd5e1'}],margin:[0,7,0,12]});continue}
    paragraph.push(line)
  }
  flush()
  if(code!==null)blocks.push({text:wrapTokens(plain(code.join('\n'))),fontSize:9,margin:[8,6,8,12],preserveLeadingSpaces:true})
  return blocks
}
export function buildDocumentPdf(doc,project) {
  if(!doc || !project || doc.projectId!==project.id || !['Completed','Draft'].includes(doc.generationStatus) || typeof doc.markdown!=='string' || !doc.markdown.trim())throw new Error('Select a saved document with Markdown content before exporting PDF.')
  if(doc.markdown.length>50000 || new TextEncoder().encode(doc.markdown).length>80000 || typeof doc.title!=='string' || doc.title.length>200 || typeof project.name!=='string' || !project.name || project.name.length>120)throw new Error('Document exceeds supported PDF export limits.')
  const generated=new Date(doc.createdAt)
  const content=[
    {text:'DEVNEXUS AI / DOCUMENTATION',fontSize:9,bold:true,color:'#b45309',characterSpacing:1.5,margin:[0,0,0,14]},
    {text:wrapTokens(plain(doc.title)),fontSize:27,bold:true,color:'#0f172a',lineHeight:1.15,margin:[0,0,0,9]},
    {text:wrapTokens(plain(project.name)),fontSize:13,color:'#475569',margin:[0,0,0,12]},
    {text:`${doc.generationStatus==='Completed' ? 'Generation' : 'Created'} date: ${!Number.isNaN(generated.valueOf()) ? generated.toISOString().replace('T',' ').replace('.000Z',' UTC').replace('Z',' UTC') : 'Unavailable'}`,style:'metadata'},
    {text:`Type: ${plain(documentTypeLabel(doc.documentType))}${isLegacyDocumentType(doc.documentType) ? ` (historical: ${plain(doc.documentType)})` : ''} | Status: ${doc.generationStatus}`,style:'metadata'},
    ...(doc.provider ? [{text:wrapTokens(`Provider: ${plain(doc.provider)}${doc.model ? ` / ${plain(doc.model)}` : ''}`),style:'metadata'}] : []),
    {canvas:[{type:'line',x1:0,y1:0,x2:475,y2:0,lineWidth:1,lineColor:'#d97706'}],margin:[0,15,0,20]},
    ...markdownPdfBlocks(doc.markdown),
    {text:'Saved source references',style:'h2',headlineLevel:2},
  ]
  if(Array.isArray(doc.sourceReferences) && doc.sourceReferences.length>200)throw new Error('Source references exceed PDF export limits.')
  if(doc.sourceReferences?.length){
    for(const ref of doc.sourceReferences){
      if(!ref || typeof ref.path!=='string' || typeof ref.fileId!=='string' || typeof ref.hash!=='string' || ref.path.length>240 || ref.fileId.length>80 || ref.hash.length>64 || (ref.lineRanges && (!Array.isArray(ref.lineRanges) || ref.lineRanges.length>60)))throw new Error('Saved source references are invalid.')
      content.push({text:wrapTokens(plain(ref.path)),bold:true,margin:[0,8,0,4]},{text:wrapTokens(`File ID: ${ref.fileId}`),style:'reference'},{text:wrapTokens(`SHA-256: ${ref.hash}`),style:'reference'})
      for(const range of ref.lineRanges || []){if(!Number.isInteger(range.lineStart) || !Number.isInteger(range.lineEnd) || range.lineStart<1 || range.lineEnd<range.lineStart)throw new Error('Saved citation range is invalid.');content.push({text:`Source lines: ${range.lineStart}-${range.lineEnd}`,style:'reference'})}
    }
  }else content.push({text:'No source references were saved.',style:'metadata'})
  content.push({text:'Saved coverage',style:'h2',headlineLevel:2})
  if(doc.coverage){
    const coverage=doc.coverage
    if(['filesSubmitted','filesIncluded','filesSkipped','filesFailed'].some(key=>!Number.isInteger(coverage[key]) || coverage[key]<0 || coverage[key]>200) || typeof coverage.truncated!=='boolean')throw new Error('Saved coverage metadata is invalid.')
    content.push({text:`Submitted: ${coverage.filesSubmitted} | Included: ${coverage.filesIncluded} | Skipped: ${coverage.filesSkipped} | Failed: ${coverage.filesFailed}`,margin:[0,3,0,6]},{text:`Truncated: ${coverage.truncated ? 'Yes' : 'No'}. Coverage records supplied inputs, not independently verified understanding.`,style:'metadata'})
  }else content.push({text:'Coverage metadata was not saved.',style:'metadata'})
  content.push({text:'AI interpretations require developer verification. This export uses saved content and source snapshot references.',fontSize:9,italics:true,color:'#64748b',margin:[0,16,0,0]})
  return {
    pageSize:'A4',pageMargins:[60,58,60,58],defaultStyle:{font:'Roboto',fontSize:10.5,lineHeight:1.25,color:'#243247'},
    info:{title:plain(doc.title),author:'DevNexus AI',subject:'Saved project documentation'},
    content,
    styles:{h1:{fontSize:20,bold:true,color:'#0f172a',margin:[0,17,0,9]},h2:{fontSize:15,bold:true,color:'#164e63',margin:[0,15,0,8]},h3:{fontSize:12,bold:true,color:'#164e63',margin:[0,12,0,7]},metadata:{fontSize:9,color:'#64748b',margin:[0,0,0,4]},reference:{fontSize:8.5,color:'#475569',margin:[0,0,0,4]}},
    footer:(page,pages)=>({columns:[{text:'DevNexus AI | Saved documentation',color:'#64748b'},{text:`Page ${page} of ${pages}`,alignment:'right',color:'#64748b'}],fontSize:8,margin:[60,20,60,0]}),
    pageBreakBefore:(node,container)=>Boolean(node.headlineLevel && container.getFollowingNodesOnPage().length===0),
  }
}
async function pdfLibrary() {
  if(!library)library=Promise.all([import('pdfmake/build/pdfmake'),import('pdfmake/build/vfs_fonts')]).then(([module,fonts])=>{
    const pdf=module.default || module
    pdf.addVirtualFileSystem(fonts.default || fonts)
    pdf.setUrlAccessPolicy(()=>false)
    return pdf
  }).catch(error=>{library=null;throw error})
  return library
}
export async function createDocumentPdf(doc,project) {
  const definition=buildDocumentPdf(doc,project)
  const pdf=await pdfLibrary()
  return pdf.createPdf(definition).getBlob()
}
export function documentPdfFilename(id) {
  if(typeof id!=='string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id))throw new Error('Invalid document export identifier.')
  return `document-${id}.pdf`
}
