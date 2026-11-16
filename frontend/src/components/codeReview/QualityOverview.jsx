function QualityOverview({ metrics }) {
  const list = metrics || [
    { label: 'Readability', value: 'Not evaluated' },
    { label: 'Maintainability', value: 'Not evaluated' },
    { label: 'Performance', value: 'Not evaluated' },
    { label: 'Best Practices', value: 'Not evaluated' },
  ]

  return (
    <section className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-[#eef1f8]">Code Quality Overview</h2>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8f99b0]">Evaluation Status</span>
      </div>
      <div className="mt-6 space-y-5">
        {list.map((metric) => {
          const isNumeric = typeof metric.value === 'number'
          return (
            <div key={metric.label}>
              <div className="mb-2 flex justify-between text-xs">
                <span className="font-semibold text-[#b9c2d6]">{metric.label}</span>
                <span className={`font-semibold ${isNumeric ? 'text-[#34d399]' : 'text-[#8f99b0]'}`}>
                  {isNumeric ? `${metric.value}%` : metric.value || 'Not evaluated'}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#1a2340]">
                {isNumeric ? (
                  <div className="h-full rounded-full progress-fill bg-[#34d399]" style={{ width: `${metric.value}%` }} />
                ) : (
                  <div className="h-full rounded-full bg-[#232c4b]" style={{ width: '0%' }} />
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-5 text-[11px] leading-relaxed text-[#8f99b0]">
        Automated percentage scoring is not evaluated without a dedicated static analysis benchmark suite. Reviews record grounded findings by category and severity.
      </p>
    </section>
  )
}

export default QualityOverview
