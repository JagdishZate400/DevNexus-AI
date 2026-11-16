import { ChevronRight } from 'lucide-react'

const severityStyles = { Critical: 'bg-[#f5e0df] text-[#a5453c]', High: 'bg-[#f2e9df] text-[#a66542]', Medium: 'bg-[#f3f0df] text-[#88733e]', Low: 'bg-[#e7eef1] text-[#416676]', Info: 'bg-[#f0f2ed] text-[#75837b]' }

function FindingCard({ finding, selected, onSelect, onStatusChange }) {
  return <article className={`rounded-xl border bg-[#121a2e] p-4 transition ${selected ? 'border-[#34d399] shadow-[0_8px_24px_rgba(24,61,52,0.07)]' : 'border-[#232c4b]'}`}><button type="button" onClick={onSelect} className="w-full text-left"><div className="flex items-start gap-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${severityStyles[finding.severity]}`}>{finding.severity}</span><div className="min-w-0 flex-1"><p className="font-bold text-[#dbe2ef]">{finding.problem}</p><p className="mt-1 truncate text-xs text-[#8f99b0]">{finding.file} · Line {finding.line}</p></div><ChevronRight size={17} className={`shrink-0 text-[#8f99b0] transition-transform ${selected ? 'rotate-90' : ''}`} /></div></button><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#1e2642] pt-3"><span className="text-[10px] font-semibold text-[#8f99b0]">{finding.category} · Potential issue detected</span><label className="text-[10px] font-bold text-[#8f99b0]">Status<select value={finding.status} onChange={(event) => onStatusChange(event.target.value)} onClick={(event) => event.stopPropagation()} className="ml-1 rounded-md border border-[#2b3558] bg-[#0e1428] px-2 py-1 text-[10px] font-normal text-[#b9c2d6] outline-none"><option>Open</option><option>Reviewed</option><option>False Positive</option><option>Fixed</option></select></label></div></article>
}

export default FindingCard
