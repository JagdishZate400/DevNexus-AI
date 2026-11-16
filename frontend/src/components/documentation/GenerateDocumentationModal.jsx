import {useEffect,useRef} from 'react'
import {X} from 'lucide-react'
import {DOCUMENTATION_TYPES,ACCEPTED_DOCUMENT_TYPES,canGenerateDocumentType} from '../../data/documentationTypes'
const field='w-full rounded-lg border border-[#354368] bg-[#0e1428] px-3 py-2.5 text-sm text-[#eef1f8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24]'
export default function GenerateDocumentationModal({isOpen,onClose,projects,projectId,onProjectChange,documentType='project-overview',onTypeChange,onGenerate,busy,disabled,error,acceptedTypes=ACCEPTED_DOCUMENT_TYPES,operation}){
  const dialog=useRef(null)
  useEffect(()=>{
    if(!isOpen)return
    const node=dialog.current,opener=document.activeElement,overflow=document.body.style.overflow
    node.showModal();document.body.style.overflow='hidden';(node.querySelector('select:not(:disabled)')||node.querySelector('button'))?.focus()
    return()=>{node.close();document.body.style.overflow=overflow;if(opener?.isConnected)opener.focus()}
  },[isOpen])
  if(!isOpen)return null
  const type=DOCUMENTATION_TYPES.find(type=>type.id===documentType),accepted=canGenerateDocumentType(documentType,acceptedTypes)
  function trap(event){
    if(event.key!=='Tab')return
    const controls=[...dialog.current.querySelectorAll('button:not(:disabled),select:not(:disabled),a[href]')].filter(node=>node.getClientRects().length)
    const first=controls[0],last=controls.at(-1)
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  }
  return <dialog ref={dialog} aria-labelledby="generate-docs-title" aria-describedby="generation-scope" onCancel={event=>{event.preventDefault();onClose()}} onKeyDown={trap} className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-[#354368] bg-[#121a2e] p-6 text-[#eef1f8] shadow-2xl backdrop:bg-[#05070f]/75 sm:p-8">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#fbbf24]">Documentation</p><h2 id="generate-docs-title" className="mt-2 text-2xl font-bold">Generate Documentation</h2></div><button type="button" onClick={onClose} aria-label="Close documentation modal" className="rounded-lg p-2 text-[#b9c2d6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24]"><X size={19}/></button></div>
    <form className="mt-7 space-y-5" onSubmit={event=>{event.preventDefault();if(!disabled&&!busy&&accepted)onGenerate()}}>
      <div><label htmlFor="gen-project" className="mb-2 block text-sm font-semibold">Project</label><select id="gen-project" value={projectId} disabled={busy||!projects?.length} onChange={event=>onProjectChange(event.target.value)} className={field}>{(projects||[]).map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
      <div><label htmlFor="gen-doc-type" className="mb-2 block text-sm font-semibold">Document Type</label><select id="gen-doc-type" value={documentType} disabled={busy||!!operation} onChange={event=>onTypeChange?.(event.target.value)} className={field}>{DOCUMENTATION_TYPES.map(type=><option key={type.id} value={type.id} disabled={!canGenerateDocumentType(type.id,acceptedTypes)}>{type.label}{canGenerateDocumentType(type.id,acceptedTypes)?'':' ? pending acceptance'}</option>)}</select></div>
      <div id="generation-scope" className="rounded-lg border border-[#283455] bg-[#0e1428] p-4 text-sm leading-relaxed text-[#b9c2d6]"><p>{type?.description}</p><p className="mt-2">Required evidence: {type?.evidence || 'Unavailable'}.</p>{documentType==='project-overview'?<p className="mt-2 text-xs text-[#8f99b0]">Representative whole source files: up to 10 files, 60,000 source bytes and 30,000 characters. No source is truncated.</p>:<p className="mt-2 text-xs text-[#8f99b0]">Source facts, static candidates, inferred relationships and untested commands are labeled separately. Required evidence is validated by the server.</p>}<p className="mt-2 text-xs text-[#8f99b0]">Source citations and AI interpretations require developer verification.</p></div>
      {!accepted&&<p role="status" className="text-sm text-[#fbbf24]">Pending acceptance. Generation is unavailable for this type.</p>}
      {operation&&<p className="text-xs leading-relaxed text-[#b9c2d6]">This operation retains its original project, type and request ID. Retrying an unconfirmed request uses that same identity. Closing this dialog does not cancel server work.</p>}
      {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
      {busy&&<p role="status" className="text-sm text-[#fbbf24]">Generating... Please wait. Do not resubmit.</p>}
      <div className="flex gap-3 border-t border-[#283455] pt-5"><button type="button" onClick={onClose} className="flex-1 rounded-lg border border-[#354368] px-4 py-3 text-sm font-bold text-[#b9c2d6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24]">{busy?'Close dialog':'Cancel'}</button><button type="submit" disabled={disabled||busy||!accepted} className="flex-1 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24] disabled:opacity-50">{busy?'Generating...':operation?.state==='Unconfirmed'?'Retry same request':'Generate Documentation'}</button></div>
    </form>
  </dialog>
}
