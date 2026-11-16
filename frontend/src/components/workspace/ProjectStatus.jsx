function ProjectStatus({ statuses }) {
  const items = [['Upload Status', statuses.upload], ['Analysis Status', statuses.analysis], ['Indexing Status', statuses.indexing], ['AI Knowledge Base', statuses.knowledgeBase]]
  return <section className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5"><h3 className="font-bold text-[#dbe2ef]">Project Status</h3><div className="mt-4 space-y-3">{items.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 border-b border-[#0e1428] pb-3 last:border-0 last:pb-0"><span className="text-xs text-[#8f99b0]">{label}</span><span className="rounded-full bg-[#1a2340] px-2.5 py-1 text-[10px] font-bold text-[#8f99b0]">{value}</span></div>)}</div></section>
}

export default ProjectStatus
