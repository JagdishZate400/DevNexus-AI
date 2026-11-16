function FileInfo({ file }) {
  if (!file) return <div className="border-b border-[#1e2642] px-5 py-4"><p className="text-sm text-[#8f99b0]">Select a file from the project explorer.</p></div>
  return <div className="border-b border-[#1e2642] px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-bold text-[#dbe2ef]">{file.name}</h3><p className="mt-1 truncate text-xs text-[#8f99b0]">{file.path}</p></div><span className="rounded-full bg-[#1a2340] px-2.5 py-1 text-[10px] font-bold text-[#34d399]">{file.language}</span></div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-[#8f99b0]"><span>{file.size}</span><span>Updated {file.updated}</span></div></div>
}

export default FileInfo
