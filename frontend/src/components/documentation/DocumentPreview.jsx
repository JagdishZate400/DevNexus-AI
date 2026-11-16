import {ChevronLeft,Download} from 'lucide-react'
import {documentTypeLabel,isLegacyDocumentType} from '../../data/documentationTypes'

function safeUrl(value) {
  try { const url=new URL(value);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
function inline(text) {
  return text.split(/(!?\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part,index)=>{
    if(part.startsWith('!['))return <span key={index}>[Image omitted]</span>
    const link=part.match(/^\[([^\]]*)\]\(([^)]*)\)$/)
    if(link){const href=safeUrl(link[2]);return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="text-[#34d399] underline">{link[1]}</a> : <span key={index}>{link[1]} [unsafe link omitted]</span>}
    if(part.startsWith('`') && part.endsWith('`'))return <code key={index} className="rounded bg-[#0e1428] px-1 font-mono">{part.slice(1,-1)}</code>
    if(part.startsWith('**') && part.endsWith('**'))return <strong key={index}>{part.slice(2,-2)}</strong>
    return part
  })
}
// Conservative Markdown subset: all text is React-escaped. No raw HTML,
// DOM injection, image elements, embeds or automatic remote resource loading.
function SafeMarkdown({markdown}) {
  const blocks=[];let code=null
  for(const [index,line] of markdown.split('\n').entries()){
    if(line.startsWith('```')){if(code!==null){blocks.push(<pre key={index} className="overflow-auto rounded-lg bg-[#0e1428] p-3 text-xs"><code>{code.join('\n')}</code></pre>);code=null}else code=[];continue}
    if(code!==null){code.push(line);continue}
    const heading=line.match(/^(#{1,6}) (.*)$/)
    if(heading){const Tag=`h${heading[1].length}`;blocks.push(<Tag key={index} className="mt-5 text-lg font-bold text-[#eef1f8]">{inline(heading[2])}</Tag>)}
    else if(/^[-*] /.test(line))blocks.push(<p key={index} className="pl-3">- {inline(line.slice(2))}</p>)
    else if(line.trim())blocks.push(<p key={index} className="whitespace-pre-wrap break-words">{inline(line)}</p>)
  }
  if(code!==null)blocks.push(<pre key="unclosed-code" className="overflow-auto whitespace-pre-wrap"><code>{code.join('\n')}</code></pre>)
  return <div data-testid="markdown-preview" className="space-y-3 text-sm leading-relaxed text-[#cdd6e8]">{blocks}</div>
}
export default function DocumentPreview({document:doc,onBack,onDownload,downloading,downloadError,onDownloadPdf,pdfExporting,pdfError}) {
  if(!doc)return null
  return <section aria-label="Document preview" className="rounded-xl border border-[#232c4b] bg-[#121a2e]">
    <div className="border-b border-[#1e2642] p-5"><button type="button" onClick={onBack} className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#34d399]"><ChevronLeft size={16}/>Back to documents</button><h2 className="text-xl font-bold text-[#eef1f8]">{doc.title}</h2><p className="mt-2 text-xs text-[#8f99b0]">{documentTypeLabel(doc.documentType)} ? {doc.generationStatus}{doc.provider ? ` ? ${doc.provider}${doc.model ? ` / ${doc.model}` : ''}` : ''}</p>{isLegacyDocumentType(doc.documentType)&&<p className="mt-2 text-xs text-[#8f99b0]">Historical type: {doc.documentType}. The saved record is unchanged.</p>}<button type="button" disabled={downloading || pdfExporting || !['Completed','Draft'].includes(doc.generationStatus)} onClick={onDownload} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#2b3558] px-3 py-2 text-sm text-[#34d399] disabled:opacity-50"><Download size={16}/>{downloading ? 'Downloading...' : 'Download Markdown'}</button><button type="button" disabled={downloading || pdfExporting || !doc.markdown?.trim() || !['Completed','Draft'].includes(doc.generationStatus)} onClick={onDownloadPdf} className="ml-3 mt-4 inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-3 py-2 text-sm font-bold text-[#231303] disabled:opacity-50"><Download size={16}/>{pdfExporting ? 'Exporting PDF...' : 'Download PDF'}</button>{pdfError && <p role="alert" className="mt-2 text-sm text-red-400">{pdfError}</p>}{downloadError && <p role="alert" className="mt-2 text-sm text-red-400">{downloadError}</p>}</div>
    <div className="p-5"><p className="mb-5 text-xs text-[#8f99b0]">Saved Markdown. AI interpretations require developer verification. HTML and remote images are not rendered.</p>{doc.markdown ? <SafeMarkdown markdown={doc.markdown}/> : <p className="text-sm text-[#8f99b0]">No saved Markdown content.</p>}</div>
    <div className="border-t border-[#1e2642] p-5"><h3 className="font-bold text-[#eef1f8]">Source references</h3>{doc.sourceReferences?.length ? <ul className="mt-3 space-y-3 text-xs text-[#b9c2d6]">{doc.sourceReferences.map(ref=><li key={ref.fileId} className="break-all"><p>{ref.path}</p><p>File ID: {ref.fileId}</p><p>SHA-256: {ref.hash}</p>{(!ref.lineRanges?.length)&&<p>Artifact identity; no line citation was saved.</p>}{ref.kind==='documentation-evidence'&&<p>Saved documentation evidence{ref.path.endsWith('.env.example')?' ? sanitized declarations only':''}.</p>}{ref.lineRanges?.map(range=><p key={`${range.lineStart}-${range.lineEnd}`}>Lines {range.lineStart}-{range.lineEnd}</p>)}</li>)}</ul> : <p className="mt-3 text-sm text-[#8f99b0]">No saved source references.</p>}</div>
    <div className="border-t border-[#1e2642] p-5"><h3 className="font-bold text-[#eef1f8]">Saved coverage</h3>{doc.coverage ? <><p className="mt-3 text-sm text-[#b9c2d6]">Submitted: {doc.coverage.filesSubmitted} ? Included: {doc.coverage.filesIncluded} ? Skipped: {doc.coverage.filesSkipped} ? Failed: {doc.coverage.filesFailed}</p><p className="mt-2 text-xs text-[#8f99b0]">Truncated: {doc.coverage.truncated ? 'Yes' : 'No'}. Included counts describe supplied evidence; skipped files may reflect document-type policy. Input coverage does not prove complete understanding.</p></> : <p className="mt-3 text-sm text-[#8f99b0]">Coverage metadata is unavailable.</p>}</div>
  </section>
}
