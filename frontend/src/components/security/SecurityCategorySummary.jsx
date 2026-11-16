import { securityCategorySummary as defaultSummary } from '../../data/securityData'

function SecurityCategorySummary({ items = defaultSummary }) {
  const bugCategories = items.filter((item) => item.type === 'Bug')
  const securityCategories = items.filter((item) => item.type === 'Security')

  return (
    <div className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 sm:p-6">
      <h2 className="text-lg font-bold text-[#eef1f8]">Finding Categories</h2>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-[#b9c2d6]">Security Findings</h3>
          <div className="mt-3 space-y-2">
            {securityCategories.length === 0 ? (
              <p className="text-sm text-[#8f99b0]">No security categories yet.</p>
            ) : (
              securityCategories.map((item) => (
                <div key={item.category} className="flex items-center justify-between">
                  <span className="text-sm text-[#b9c2d6]">{item.category}</span>
                  <span className="rounded-full bg-[#efe8f5] px-2.5 py-1 text-xs font-bold text-[#603d7a]">
                    {item.count}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#b9c2d6]">Bug Findings</h3>
          <div className="mt-3 space-y-2">
            {bugCategories.length === 0 ? (
              <p className="text-sm text-[#8f99b0]">No bug categories yet.</p>
            ) : (
              bugCategories.map((item) => (
                <div key={item.category} className="flex items-center justify-between">
                  <span className="text-sm text-[#b9c2d6]">{item.category}</span>
                  <span className="rounded-full bg-[#e8eff5] px-2.5 py-1 text-xs font-bold text-[#3d5a7a]">
                    {item.count}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SecurityCategorySummary
