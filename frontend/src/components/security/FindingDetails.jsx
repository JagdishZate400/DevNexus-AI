import SecurityCodePreview from './SecurityCodePreview'

function FindingDetails({ finding }) {
  if (!finding)
    return (
      <div className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-8 text-center">
        <p className="text-sm text-[#8f99b0]">Select a finding to view details</p>
      </div>
    )

  const severityStyles = {
    Critical: 'bg-[#f5e0df] text-[#a5453c]',
    High: 'bg-[#f2e9df] text-[#a66542]',
    Medium: 'bg-[#f3f0df] text-[#88733e]',
    Low: 'bg-[#e7eef1] text-[#416676]',
    Info: 'bg-[#f0f2ed] text-[#75837b]',
  }

  const typeStyles = {
    Bug: 'bg-[#e8eff5] text-[#3d5a7a]',
    Security: 'bg-[#efe8f5] text-[#603d7a]',
  }

  const statusStyles = {
    Open: 'bg-[#f3f0df] text-[#88733e]',
    Reviewed: 'bg-[#e7eef1] text-[#416676]',
    'False Positive': 'bg-[#f0f2ed] text-[#75837b]',
    Fixed: 'bg-[#1a2340] text-[#34d399]',
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#232c4b] bg-[#121a2e]">
      <div className="border-b border-[#1e2642] px-5 py-4 sm:px-6">
        <h2 className="text-lg font-bold text-[#eef1f8]">{finding.title}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${severityStyles[finding.severity]}`}
          >
            {finding.severity}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${typeStyles[finding.type]}`}>
            {finding.type}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyles[finding.status]}`}>
            {finding.status}
          </span>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        <div className="animate-stagger grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#8f99b0]">
              File
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-[#dbe2ef]">{finding.file}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#8f99b0]">
              Line
            </p>
            <p className="mt-1 text-sm font-semibold text-[#dbe2ef]">{finding.line}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#8f99b0]">
              Category
            </p>
            <p className="mt-1 text-sm font-semibold text-[#dbe2ef]">{finding.category}</p>
          </div>
        </div>

        <div className="border-t border-[#1e2642] pt-4">
          <h3 className="text-sm font-bold text-[#eef1f8]">Problem</h3>
          <p className="mt-2 text-sm text-[#b9c2d6]">{finding.problem}</p>
        </div>

        <div>
          <h3 className="text-sm font-bold text-[#eef1f8]">Explanation</h3>
          <p className="mt-2 text-sm text-[#b9c2d6]">{finding.explanation}</p>
        </div>

        <div>
          <h3 className="text-sm font-bold text-[#eef1f8]">Recommendation</h3>
          <p className="mt-2 text-sm text-[#b9c2d6]">{finding.recommendation}</p>
        </div>

        <div className="rounded-lg border border-[#1e2642] bg-[#0e1428] p-3">
          <p className="text-[10px] font-semibold text-[#8f99b0]">
            ⓘ AI-assisted findings should be verified by a developer or security reviewer.
          </p>
        </div>
      </div>

      <div className="border-t border-[#1e2642] px-5 py-5 sm:px-6">
        {finding.code!==undefined ? <SecurityCodePreview finding={finding} /> : <p className="text-sm text-[#8f99b0]">Source evidence has not been loaded.</p>}
        {finding.suggestedCode && <><p className="mt-4 text-sm">Suggested code ? verify before use</p><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs"><code>{finding.suggestedCode}</code></pre></>}
      </div>
    </div>
  )
}

export default FindingDetails
