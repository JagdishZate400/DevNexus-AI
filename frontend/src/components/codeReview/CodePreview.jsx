function CodePreview({ finding }) {
  if (!finding) return null
  return <div className="overflow-hidden rounded-lg border border-[#232c4b] bg-[#0e1428]"><div className="border-b border-[#1e2642] px-4 py-3"><p className="text-xs font-bold text-[#b9c2d6]">Code preview</p><p className="mt-1 truncate text-[10px] text-[#8f99b0]">{finding.file} · affected line {finding.line}</p></div><pre className="max-h-44 overflow-auto p-4 font-mono text-xs leading-6 text-[#cdd6e8]"><code>{finding.code}</code></pre></div>
}

export default CodePreview
