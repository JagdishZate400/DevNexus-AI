import {BookOpen,Code,FileText,Layers,Lightbulb,GitBranch,FolderOpen,Package,Wrench} from 'lucide-react'
import {DOCUMENTATION_TYPES,ACCEPTED_DOCUMENT_TYPES,canGenerateDocumentType} from '../../data/documentationTypes'
const icons={BookOpen,Code,FileText,Layers,Lightbulb,GitBranch,FolderOpen,Package,Wrench}
export default function DocumentTypes({available=false,onGenerateClick,acceptedTypes=ACCEPTED_DOCUMENT_TYPES}){
  return <section aria-label="Documentation types" className="mt-8">
    <h2 className="mb-3 text-2xl font-bold text-[#eef1f8]">Document Types</h2>
    <p className="mb-5 text-sm text-[#8f99b0]">Availability reflects acceptance status. Saved documents remain viewable even when new generation is unavailable.</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{DOCUMENTATION_TYPES.map(type=>{
      const Icon=icons[type.icon],accepted=canGenerateDocumentType(type.id,acceptedTypes)
      return <article key={type.id} aria-label={type.label} className="flex flex-col rounded-xl border border-[#232c4b] bg-[#121a2e] p-5">
        <div className="flex gap-3"><Icon size={21} className="mt-1 shrink-0 text-[#34d399]" aria-hidden="true"/><div><h3 className="font-bold text-[#eef1f8]">{type.label}</h3><p className="mt-2 text-sm text-[#b9c2d6]">{type.description}</p></div></div>
        <p className="mt-4 text-xs leading-relaxed text-[#8f99b0]">Evidence: {type.evidence}.</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-5"><span className={`text-xs font-semibold ${accepted?'text-[#34d399]':'text-[#fbbf24]'}`}>{accepted?'Available':'Pending acceptance'}</span><button type="button" disabled={!accepted||!available} onClick={()=>onGenerateClick?.(type.id)} aria-label={`Generate ${type.label}`} className="rounded-lg border border-[#354368] px-3 py-2 text-xs font-semibold text-[#6ee7b7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fbbf24] disabled:opacity-45">{accepted?'Generate':'Pending acceptance'}</button></div>
      </article>
    })}</div>
  </section>
}
