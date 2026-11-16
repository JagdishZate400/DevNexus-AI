import { severityOverview as defaultOverview } from '../../data/securityData'

const barColor = {
  Critical: 'bg-[#a5453c]',
  High: 'bg-[#a66542]',
  Medium: 'bg-[#88733e]',
  Low: 'bg-[#416676]',
  Info: 'bg-[#75837b]',
}

function SeverityOverview({ items = defaultOverview, total }) {
  const max = Math.max(total || items.reduce((sum, item) => sum + item.count, 0), 1)

  return (
    <div className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 sm:p-6">
      <h2 className="text-lg font-bold text-[#eef1f8]">Severity Overview</h2>

      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.level}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#b9c2d6]">{item.level}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.color || 'bg-[#1a2340] text-[#b9c2d6]'}`}>
                {item.count}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#1e2642]">
              <div
                className={`h-full ${barColor[item.level] || 'bg-[#75837b]'}`}
                style={{ width: `${(item.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 border-t border-[#1e2642] pt-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((item) => (
            <div key={item.level} className="text-center">
              <p className="text-2xl font-bold text-[#eef1f8]">{item.count}</p>
              <p className="text-[10px] text-[#8f99b0]">{item.level}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SeverityOverview
