import { documentationCoverage } from '../../data/documentationData'

function DocumentationCoverage() {
  return (
    <div className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#eef1f8]">Documentation Coverage</h2>
        <span className="text-[10px] font-bold text-[#8f99b0]">Mock/Demo Data</span>
      </div>

      <div className="mt-5 space-y-4">
        {documentationCoverage.map((item) => (
          <div key={item.type}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#b9c2d6]">{item.type}</span>
              <span className="text-xs font-bold text-[#34d399]">{item.coverage}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#1e2642]">
              <div
                className="h-full bg-[#34d399] transition-all duration-300"
                style={{ width: `${item.coverage}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-[#1e2642] bg-[#0e1428] p-3">
        <p className="text-[10px] font-semibold text-[#8f99b0]">
          ⓘ This coverage data is mock/demo data. Actual coverage will be calculated based on your generated documentation.
        </p>
      </div>
    </div>
  )
}

export default DocumentationCoverage
